"use client"

import { useEffect, useState, useTransition, type ReactNode } from "react"
import { createPortal } from "react-dom"
import { useRouter } from "next/navigation"
import { BuilderPreview } from "@/components/onboarding-builder/BuilderPreview"
import { RoundPill, SquarePill } from "@/components/ui"
import { WorkspaceSuccessNotice } from "@/components/workspace/WorkspaceSuccessNotice"
import type { OnboardingHelpSettings, OnboardingModuleDefinition, OnboardingThemeDefinition } from "@/lib/onboarding/configuration-types"
import type { RelationshipPhase } from "@/lib/relationship-phases"
import type { RelationshipGanttPlan } from "@/lib/relationship-gantt"
import { postGanttSync } from "@/lib/ui/gantt-sync"
import { WORKSPACE_TAB_FRAME_PARAM, workspaceTabFrameUrl } from "@/lib/workspace-tabs"
import { proceedRelationshipCurrentWork, saveRelationshipDealDetails, type RelationshipDealDetailsInput } from "../actions"
import { RelationshipGantt } from "./RelationshipGantt"

type Member = { id: string; name: string }
type DealService = {
    code: string
    serviceId: string | null
    revisionId: string | null
    name: string
    description: string
    defaultPriceCents: number
    currency: string
    isTest: boolean
    revisionNumber: number | null
    selected: boolean
    selectedPriceCents: number
    selectedCurrency: string
    selectedAssigneeId: string | null
    moduleIds: string[]
}
type RelationshipDetails = {
    primaryPersonName: string
    businessName: string
    primaryContactRole: string
    primaryPhone: string
    whatsappPhone: string
    primaryEmail: string
    sellerUserId: string
    fulfilmentManagerUserId: string
    projectTimeframeDays: number | null
    description: string
    lifecyclePhase: RelationshipPhase
}
type CurrentWork = { id: string; title: string; action: string | null; role: string; status: string; unassignedCount: number; blocked: boolean }
type Draft = Omit<RelationshipDetails, "lifecyclePhase"> & {
    selectedCodes: string[]
    prices: Record<string, number>
    currency: string
}

const inputClass = "min-h-7 w-full min-w-0 bg-transparent text-sm text-neutral-200 outline-none placeholder:text-neutral-700 focus:text-white"

function DetailIcon({ kind }: { kind: "identity" | "contact" | "person" | "timeline" | "services" | "description" }) {
    const path = kind === "identity"
        ? <><circle cx="12" cy="8" r="4" /><path d="M4.5 20c.8-4 3.3-6 7.5-6s6.7 2 7.5 6" /></>
        : kind === "contact"
            ? <><path d="M5 5h14v14H5z" /><path d="m6 7 6 5 6-5" /></>
            : kind === "person"
                ? <><circle cx="8" cy="8" r="3" /><circle cx="16" cy="8" r="3" /><path d="M3 20c.5-4 2.2-6 5-6M21 20c-.5-4-2.2-6-5-6" /></>
                : kind === "timeline"
                    ? <><path d="M7 3v3M17 3v3M4 9h16" /><rect x="4" y="5" width="16" height="15" rx="2" /></>
                    : kind === "services"
                        ? <><path d="M4 7h16M4 12h16M4 17h16" /><circle cx="7" cy="7" r="1" /><circle cx="12" cy="12" r="1" /><circle cx="17" cy="17" r="1" /></>
                        : <><path d="M5 5h14M5 9h14M5 13h10M5 17h12" /></>
    return <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4 shrink-0">{path}</svg>
}

function DetailField({ label, icon, children, className = "" }: { label: string; icon: Parameters<typeof DetailIcon>[0]["kind"]; children: ReactNode; className?: string }) {
    return <div className={`grid min-h-11 grid-cols-[8.5rem_minmax(0,1fr)] items-start gap-3 border-b border-neutral-900 py-2.5 ${className}`}>
        <p className="flex items-center gap-2 pt-1 text-sm text-neutral-500"><DetailIcon kind={icon} /><span>{label}</span></p>
        <div className="min-w-0 text-sm text-neutral-200">{children}</div>
    </div>
}

function missingText(value: string, message: string) {
    return value.trim() ? null : message
}

function emailIssue(value: string) {
    if (!value.trim()) return "Billing email required"
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim()) ? null : "Enter a usable billing email"
}

function whatsappIssue(value: string) {
    return value.replace(/\D/g, "").length >= 8 ? null : "WhatsApp number required"
}

function priceLabel(cents: number, currency: string) {
    try {
        return new Intl.NumberFormat("en-IE", { style: "currency", currency: currency.toUpperCase() }).format(cents / 100)
    } catch {
        return `${currency.toUpperCase()} ${(cents / 100).toFixed(2)}`
    }
}

function buildInitialDraft(details: RelationshipDetails, services: DealService[]): Draft {
    const selected = services.filter((service) => service.selected)
    return {
        primaryPersonName: details.primaryPersonName,
        businessName: details.businessName,
        primaryContactRole: details.primaryContactRole,
        primaryPhone: details.primaryPhone,
        whatsappPhone: details.whatsappPhone,
        primaryEmail: details.primaryEmail,
        sellerUserId: details.sellerUserId,
        fulfilmentManagerUserId: details.fulfilmentManagerUserId,
        projectTimeframeDays: details.projectTimeframeDays,
        description: details.description,
        selectedCodes: selected.map((service) => service.code),
        prices: Object.fromEntries(services.map((service) => [service.code, service.selected ? service.selectedPriceCents : service.defaultPriceCents])),
        currency: selected[0]?.selectedCurrency ?? services[0]?.currency ?? "USD",
    }
}

function MissingHint({ message }: { message: string | null }) {
    return message ? <span className="mt-1 block text-[11px] text-amber-300">{message}</span> : null
}

export function RelationshipDealWorkspace({
    workspaceSlug,
    workspaceName,
    relationshipId,
    details,
    members,
    services,
    modules,
    theme,
    help,
    schemaReady,
    whatsappVerified,
    commercialLocked,
    plan,
    canEdit,
    currentWork,
    frozenInvoiceNotice,
}: {
    workspaceSlug: string
    workspaceName: string
    relationshipId: string
    details: RelationshipDetails
    members: Member[]
    services: DealService[]
    modules: OnboardingModuleDefinition[]
    theme: OnboardingThemeDefinition
    help: OnboardingHelpSettings
    schemaReady: boolean
    whatsappVerified: boolean
    commercialLocked: boolean
    plan: RelationshipGanttPlan
    canEdit: boolean
    currentWork: CurrentWork | null
    frozenInvoiceNotice?: ReactNode
}) {
    const router = useRouter()
    const [draft, setDraft] = useState(() => buildInitialDraft(details, services))
    const [baseline, setBaseline] = useState(() => buildInitialDraft(details, services))
    const [servicesOpen, setServicesOpen] = useState(false)
    const [invoiceOpen, setInvoiceOpen] = useState(false)
    const [invoiceStep, setInvoiceStep] = useState(0)
    const [previewModule, setPreviewModule] = useState<OnboardingModuleDefinition | null>(null)
    const [error, setError] = useState<string | null>(null)
    const [notice, setNotice] = useState<{ label: string; href: string | null } | null>(null)
    const [pending, startTransition] = useTransition()
    const parentDocument = typeof window !== "undefined" && window.parent !== window ? window.parent.document : typeof document !== "undefined" ? document : null
    const selectedServices = services.filter((service) => draft.selectedCodes.includes(service.code))
    const selectedModuleIds = new Set([
        ...modules.filter((module) => module.mandatory).map((module) => module.id),
        ...selectedServices.flatMap((service) => service.moduleIds),
    ])
    const assignedModules = modules.filter((module) => selectedModuleIds.has(module.id)).sort((left, right) => (left.sortOrder ?? 0) - (right.sortOrder ?? 0))
    const invoiced = ["invoiced", "onboarding", "onboarding_review", "fulfilment", "retention", "completed_lost"].includes(details.lifecyclePhase)
    const dirty = JSON.stringify(draft) !== JSON.stringify(baseline)
    const relationshipIssues = [
        missingText(draft.primaryPersonName, "Client name required"),
        emailIssue(draft.primaryEmail),
        whatsappIssue(draft.whatsappPhone),
        draft.selectedCodes.length ? null : "Select at least one service",
    ].filter((issue): issue is string => Boolean(issue))
    const onboardingIssues = [
        schemaReady ? null : "The Builder schema is not available",
        whatsappVerified ? null : "The workspace WhatsApp connection is not verified",
        assignedModules.length ? null : "The selected services do not produce a published onboarding",
    ].filter((issue): issue is string => Boolean(issue))
    const pricingIssues = [
        /^[A-Z]{3}$/.test(draft.currency.toUpperCase()) ? null : "Use a three-letter currency code",
        ...selectedServices.flatMap((service) => (draft.prices[service.code] ?? 0) > 0 ? [] : [`Add a positive price for ${service.name}`]),
    ].filter((issue): issue is string => Boolean(issue))
    const totalCents = selectedServices.reduce((total, service) => total + (draft.prices[service.code] ?? 0), 0)

    useEffect(() => {
        if (!notice) return
        const timeout = window.setTimeout(() => setNotice(null), 8400)
        return () => window.clearTimeout(timeout)
    }, [notice])

    function update<K extends keyof Draft>(key: K, value: Draft[K]) {
        setDraft((current) => ({ ...current, [key]: value }))
    }

    function toggleService(code: string) {
        setDraft((current) => ({
            ...current,
            selectedCodes: current.selectedCodes.includes(code)
                ? current.selectedCodes.filter((item) => item !== code)
                : [...current.selectedCodes, code],
        }))
    }

    function dealInput(): RelationshipDealDetailsInput {
        return {
            primaryPersonName: draft.primaryPersonName,
            businessName: draft.businessName,
            primaryContactRole: draft.primaryContactRole,
            primaryPhone: draft.primaryPhone,
            whatsappPhone: draft.whatsappPhone,
            primaryEmail: draft.primaryEmail,
            sellerUserId: draft.sellerUserId,
            fulfilmentManagerUserId: draft.fulfilmentManagerUserId,
            projectTimeframeDays: draft.projectTimeframeDays,
            description: draft.description,
            services: selectedServices.map((service) => ({
                code: service.code,
                serviceId: service.serviceId,
                revisionId: service.revisionId,
                priceCents: Math.max(0, Math.round(draft.prices[service.code] ?? 0)),
                currency: draft.currency.toUpperCase(),
                assigneeUserId: service.selectedAssigneeId,
            })),
        }
    }

    async function saveDetails() {
        const outcome = await saveRelationshipDealDetails(workspaceSlug, relationshipId, dealInput())
        if (!outcome.ok) {
            setError(outcome.error)
            return false
        }
        setBaseline(draft)
        setError(null)
        router.refresh()
        postGanttSync(workspaceSlug)
        return true
    }

    function openInvoiceReview() {
        setError(null)
        setInvoiceStep(0)
        setInvoiceOpen(true)
    }

    function nextFromRelationship() {
        if (relationshipIssues.length) {
            setError("Complete the highlighted relationship information before reviewing onboarding.")
            return
        }
        startTransition(() => { void saveDetails().then((saved) => { if (saved) setInvoiceStep(1) }) })
    }

    function invoiceClient() {
        if (!currentWork || currentWork.action !== "send_invoice") {
            setError("This relationship is no longer waiting to be invoiced. Reload and review its current stage.")
            return
        }
        if (pricingIssues.length) {
            setError(pricingIssues[0])
            return
        }
        startTransition(() => {
            void (async () => {
                if (!await saveDetails()) return
                const outcome = await proceedRelationshipCurrentWork(workspaceSlug, relationshipId, currentWork.id)
                if (!outcome.ok) {
                    setError(outcome.error)
                    return
                }
                setInvoiceOpen(false)
                setNotice({ label: "Invoice sent", href: outcome.invoice?.href ?? null })
                router.refresh()
                postGanttSync(workspaceSlug)
            })().catch(() => setError("The invoice could not be sent. Please try again."))
        })
    }

    function navigateToInvoice() {
        if (!notice?.href) return
        const tabId = new URLSearchParams(window.location.search).get(WORKSPACE_TAB_FRAME_PARAM)
        window.location.assign(tabId ? workspaceTabFrameUrl(notice.href, tabId, window.location.origin) : notice.href)
    }

    const detailsPanel = <section data-relationship-details className="overflow-hidden rounded-xl border border-neutral-800 bg-black px-4 sm:px-5">
        <div className="grid gap-x-8 lg:grid-cols-2">
            <DetailField label="Name" icon="identity"><input disabled={!canEdit} value={draft.primaryPersonName} onChange={(event) => update("primaryPersonName", event.target.value)} placeholder="Client name" className={inputClass} /></DetailField>
            <DetailField label="Company" icon="identity" className="lg:border-l lg:border-neutral-900 lg:pl-8"><input disabled={!canEdit} value={draft.businessName} onChange={(event) => update("businessName", event.target.value)} placeholder="No company" className={inputClass} /></DetailField>
            <DetailField label="Role" icon="identity"><input disabled={!canEdit} value={draft.primaryContactRole} onChange={(event) => update("primaryContactRole", event.target.value)} placeholder="Not set" className={inputClass} /></DetailField>
            <DetailField label="SMS number" icon="contact" className="lg:border-l lg:border-neutral-900 lg:pl-8"><input disabled={!canEdit} type="tel" value={draft.primaryPhone} onChange={(event) => update("primaryPhone", event.target.value)} placeholder="Not set" className={inputClass} /></DetailField>
            <DetailField label="WhatsApp" icon="contact"><input disabled={!canEdit} type="tel" value={draft.whatsappPhone} onChange={(event) => update("whatsappPhone", event.target.value)} placeholder="Required before invoicing" className={inputClass} /></DetailField>
            <DetailField label="Email" icon="contact" className="lg:border-l lg:border-neutral-900 lg:pl-8"><input disabled={!canEdit} type="email" value={draft.primaryEmail} onChange={(event) => update("primaryEmail", event.target.value)} placeholder="Required before invoicing" className={inputClass} /></DetailField>
            <DetailField label="Seller" icon="person"><select disabled={!canEdit} value={draft.sellerUserId} onChange={(event) => update("sellerUserId", event.target.value)} className={inputClass}><option value="">Unassigned</option>{members.map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}</select></DetailField>
            <DetailField label="Fulfilment manager" icon="person" className="lg:border-l lg:border-neutral-900 lg:pl-8"><select disabled={!canEdit} value={draft.fulfilmentManagerUserId} onChange={(event) => update("fulfilmentManagerUserId", event.target.value)} className={inputClass}><option value="">Choose before fulfilment</option>{members.map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}</select></DetailField>
            <DetailField label={invoiced ? "Project timeline" : "Planned project timeline"} icon="timeline" className="lg:col-span-2"><div className="flex items-center gap-2"><input disabled={!canEdit} type="number" min="1" value={draft.projectTimeframeDays ?? ""} onChange={(event) => update("projectTimeframeDays", event.target.value ? Number(event.target.value) : null)} placeholder="Not set" className={`${inputClass} max-w-24`} />{draft.projectTimeframeDays ? <span className="text-neutral-500">days</span> : null}</div></DetailField>
        </div>
        <DetailField label="Services" icon="services" className="grid-cols-1 gap-2 sm:grid-cols-[8.5rem_minmax(0,1fr)]">
            <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                {selectedServices.map((service) => <RoundPill key={service.code} tone="emerald">{service.name}</RoundPill>)}
                {!selectedServices.length ? <span className="text-neutral-600">None</span> : null}
                {canEdit && !commercialLocked ? <button type="button" onClick={() => setServicesOpen((open) => !open)} className="ml-auto text-xs text-neutral-400 underline underline-offset-4 hover:text-white">{servicesOpen ? "Done" : "Edit services"}</button> : null}
            </div>
            {servicesOpen && !commercialLocked ? <div className="mt-2 grid gap-1.5 rounded-lg border border-neutral-800 bg-neutral-950 p-2 sm:grid-cols-2 lg:grid-cols-3">{services.map((service) => <label key={service.code} className="flex items-start gap-2 rounded-md px-2 py-2 text-sm hover:bg-neutral-900"><input type="checkbox" checked={draft.selectedCodes.includes(service.code)} onChange={() => toggleService(service.code)} className="mt-0.5" /><span className="min-w-0"><span className="flex items-center gap-1.5"><span className="truncate text-neutral-200">{service.name}</span>{service.isTest ? <SquarePill tone="yellow">Test</SquarePill> : null}</span><span className="mt-0.5 block truncate text-[11px] text-neutral-600">{service.revisionNumber ? `Revision ${service.revisionNumber}` : service.code}</span></span></label>)}</div> : null}
        </DetailField>
        <DetailField label="Description" icon="description" className="grid-cols-1 gap-2 border-b-0 sm:grid-cols-[8.5rem_minmax(0,1fr)]"><textarea disabled={!canEdit} value={draft.description} onChange={(event) => update("description", event.target.value)} rows={3} placeholder="Add relationship context…" className={`${inputClass} min-h-20 resize-none leading-6`} /></DetailField>
        {error && !invoiceOpen ? <p className="border-t border-red-500/20 py-2 text-sm text-red-300">{error}</p> : null}
        {dirty && canEdit ? <div className="flex justify-end gap-2 border-t border-neutral-900 py-2.5"><button type="button" disabled={pending} onClick={() => { setDraft(baseline); setServicesOpen(false); setError(null) }} className="h-8 px-2 text-xs text-neutral-400 hover:text-white disabled:opacity-50">Cancel</button><button type="button" disabled={pending} onClick={() => startTransition(() => { void saveDetails() })} className="h-8 rounded-md bg-white px-3 text-xs font-medium text-black disabled:opacity-50">{pending ? "Saving…" : "Save changes"}</button></div> : null}
    </section>

    const modal = invoiceOpen && parentDocument ? createPortal(<div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/75 p-3 text-white backdrop-blur-sm">
        <section role="dialog" aria-modal="true" aria-labelledby="invoice-review-title" className="flex max-h-[min(92dvh,56rem)] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-neutral-700 bg-neutral-950 shadow-2xl shadow-black/70">
            <header className="shrink-0 border-b border-neutral-800 px-4 py-4 sm:px-6">
                <div className="flex items-start justify-between gap-4"><div><p className="text-xs font-medium uppercase tracking-[0.16em] text-neutral-500">Invoice client</p><h2 id="invoice-review-title" className="mt-1 text-xl font-semibold">{invoiceStep === 0 ? "Review Relationship Information" : invoiceStep === 1 ? "Review Onboarding" : "Pricing"}</h2><p className="mt-1 text-sm text-neutral-500">{invoiceStep === 0 ? "Double-check the client's details and the services they are buying." : invoiceStep === 1 ? "Confirm the published onboarding this client will receive." : "Review the invoice total and adjust any negotiated prices."}</p></div><button type="button" aria-label="Close invoice review" onClick={() => { setInvoiceOpen(false); setError(null) }} className="text-neutral-500 hover:text-white">✕</button></div>
                <div className="mt-4 grid grid-cols-3 gap-2" aria-label={`Step ${invoiceStep + 1} of 3`}>{["Relationship", "Onboarding", "Pricing"].map((label, index) => <div key={label}><div className={`h-1 rounded-full ${index <= invoiceStep ? "bg-white" : "bg-neutral-800"}`} /><p className={`mt-1.5 text-[11px] ${index === invoiceStep ? "text-white" : "text-neutral-600"}`}>{index + 1}. {label}</p></div>)}</div>
            </header>
            <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-6 sm:py-5">
                {invoiceStep === 0 ? <div className="grid gap-3 sm:grid-cols-2">
                    <label className="text-xs text-neutral-500">Name<input value={draft.primaryPersonName} onChange={(event) => update("primaryPersonName", event.target.value)} className="mt-1.5 h-10 w-full rounded-lg border border-neutral-700 bg-black px-3 text-sm text-white" /><MissingHint message={missingText(draft.primaryPersonName, "Required")} /></label>
                    <label className="text-xs text-neutral-500">Company<input value={draft.businessName} onChange={(event) => update("businessName", event.target.value)} placeholder="Optional" className="mt-1.5 h-10 w-full rounded-lg border border-neutral-700 bg-black px-3 text-sm text-white" /></label>
                    <label className="text-xs text-neutral-500">Role<input value={draft.primaryContactRole} onChange={(event) => update("primaryContactRole", event.target.value)} placeholder="Optional" className="mt-1.5 h-10 w-full rounded-lg border border-neutral-700 bg-black px-3 text-sm text-white" /></label>
                    <label className="text-xs text-neutral-500">SMS number<input type="tel" value={draft.primaryPhone} onChange={(event) => update("primaryPhone", event.target.value)} placeholder="Optional" className="mt-1.5 h-10 w-full rounded-lg border border-neutral-700 bg-black px-3 text-sm text-white" /></label>
                    <label className="text-xs text-neutral-500">WhatsApp number<input type="tel" value={draft.whatsappPhone} onChange={(event) => update("whatsappPhone", event.target.value)} className="mt-1.5 h-10 w-full rounded-lg border border-neutral-700 bg-black px-3 text-sm text-white" /><MissingHint message={whatsappIssue(draft.whatsappPhone)} /></label>
                    <label className="text-xs text-neutral-500">Billing email<input type="email" value={draft.primaryEmail} onChange={(event) => update("primaryEmail", event.target.value)} className="mt-1.5 h-10 w-full rounded-lg border border-neutral-700 bg-black px-3 text-sm text-white" /><MissingHint message={emailIssue(draft.primaryEmail)} /></label>
                    <label className="text-xs text-neutral-500">Seller<select value={draft.sellerUserId} onChange={(event) => update("sellerUserId", event.target.value)} className="mt-1.5 h-10 w-full rounded-lg border border-neutral-700 bg-black px-3 text-sm text-white"><option value="">Unassigned</option>{members.map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}</select></label>
                    <label className="text-xs text-neutral-500">Fulfilment manager<select value={draft.fulfilmentManagerUserId} onChange={(event) => update("fulfilmentManagerUserId", event.target.value)} className="mt-1.5 h-10 w-full rounded-lg border border-neutral-700 bg-black px-3 text-sm text-white"><option value="">Choose before fulfilment</option>{members.map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}</select></label>
                    <label className="text-xs text-neutral-500">Planned project timeline<div className="mt-1.5 flex h-10 items-center rounded-lg border border-neutral-700 bg-black px-3"><input type="number" min="1" value={draft.projectTimeframeDays ?? ""} onChange={(event) => update("projectTimeframeDays", event.target.value ? Number(event.target.value) : null)} placeholder="Optional" className="min-w-0 flex-1 bg-transparent text-sm text-white outline-none" />{draft.projectTimeframeDays ? <span className="text-xs text-neutral-500">days</span> : null}</div></label>
                    <div className="sm:col-span-2"><p className="text-xs text-neutral-500">Services</p><div className="mt-1.5 grid gap-1.5 rounded-lg border border-neutral-800 bg-black p-2 sm:grid-cols-2">{services.map((service) => <label key={service.code} className="flex items-start gap-2 rounded-md px-2 py-2 hover:bg-neutral-900"><input type="checkbox" checked={draft.selectedCodes.includes(service.code)} onChange={() => toggleService(service.code)} className="mt-0.5" /><span className="min-w-0"><span className="flex items-center gap-1.5 text-sm text-neutral-200">{service.name}{service.isTest ? <SquarePill tone="yellow">Test</SquarePill> : null}</span><span className="mt-0.5 block text-[11px] text-neutral-600">{service.description || `Service ${service.code}`}</span></span></label>)}</div><MissingHint message={draft.selectedCodes.length ? null : "Select at least one service"} /></div>
                    <label className="text-xs text-neutral-500 sm:col-span-2">Description<textarea value={draft.description} onChange={(event) => update("description", event.target.value)} rows={3} placeholder="Optional relationship context" className="mt-1.5 min-h-20 w-full resize-none rounded-lg border border-neutral-700 bg-black px-3 py-2 text-sm leading-6 text-white" /></label>
                </div> : null}
                {invoiceStep === 1 ? <div className="space-y-3">{onboardingIssues.length ? <div className="rounded-lg border border-amber-500/25 bg-amber-950/15 px-3 py-2.5 text-xs leading-5 text-amber-200">{onboardingIssues.map((issue) => <p key={issue}>{issue}</p>)}</div> : null}<div className="flex flex-wrap gap-1.5">{assignedModules.map((module) => <RoundPill key={module.id} tone="sky">{module.name}</RoundPill>)}</div><div className="divide-y divide-neutral-900 overflow-hidden rounded-xl border border-neutral-800 bg-black">{assignedModules.map((module) => <div key={module.id} className="flex items-center gap-3 px-3 py-3"><div className="min-w-0 flex-1"><p className="truncate text-sm font-medium text-neutral-100">{module.name}</p><p className="mt-1 text-xs text-neutral-600">{module.steps.length} step{module.steps.length === 1 ? "" : "s"}{module.mandatory ? " · mandatory" : " · selected service"}</p></div><button type="button" onClick={() => setPreviewModule(module)} className="h-8 rounded-md border border-neutral-700 px-3 text-xs text-neutral-200 hover:border-neutral-500">Preview</button></div>)}</div></div> : null}
                {invoiceStep === 2 ? <div><div className="mb-4 flex flex-col justify-between gap-3 rounded-xl border border-neutral-800 bg-black p-3 sm:flex-row sm:items-center"><div><p className="text-sm font-medium">Invoice currency</p><p className="mt-1 text-xs text-neutral-600">One currency applies to the whole invoice.</p></div><input value={draft.currency} onChange={(event) => update("currency", event.target.value.toUpperCase().slice(0, 3))} maxLength={3} aria-label="Invoice currency" className="h-9 w-24 rounded-lg border border-neutral-700 bg-neutral-950 px-3 text-sm uppercase text-white" /></div><div className="divide-y divide-neutral-900 overflow-hidden rounded-xl border border-neutral-800 bg-black">{selectedServices.map((service) => <div key={service.code} className="grid gap-3 px-3 py-3 sm:grid-cols-[minmax(0,1fr)_8rem_9rem] sm:items-center"><div className="min-w-0"><p className="truncate text-sm font-medium text-neutral-100">{service.name}</p><p className="mt-1 text-xs text-neutral-600">Default {priceLabel(service.defaultPriceCents, draft.currency)}</p></div><label className="text-xs text-neutral-500">Price<input type="number" min="0" step="0.01" value={(draft.prices[service.code] ?? 0) / 100} onChange={(event) => setDraft((current) => ({ ...current, prices: { ...current.prices, [service.code]: Math.round(Number(event.target.value || 0) * 100) } }))} className="mt-1 h-9 w-full rounded-lg border border-neutral-700 bg-neutral-950 px-2 text-sm text-white" /></label><p className="text-right text-sm font-medium text-neutral-200">{priceLabel(draft.prices[service.code] ?? 0, draft.currency)}</p></div>)}</div><div className="mt-4 flex items-end justify-between gap-4 border-t border-neutral-800 pt-4"><div><p className="text-xs text-neutral-500">Invoice total</p><p className="mt-1 text-2xl font-semibold">{priceLabel(totalCents, draft.currency)}</p></div><p className="max-w-sm text-right text-xs leading-5 text-neutral-600">Sending freezes these services, prices and the published onboarding shown in the previous step.</p></div></div> : null}
                {error ? <p role="alert" className="mt-4 rounded-lg border border-red-500/20 bg-red-950/20 px-3 py-2.5 text-sm text-red-300">{error}</p> : null}
            </div>
            <footer className="flex shrink-0 items-center justify-between gap-3 border-t border-neutral-800 px-4 py-3 sm:px-6"><button type="button" disabled={invoiceStep === 0 || pending} onClick={() => { setInvoiceStep((step) => Math.max(0, step - 1)); setError(null) }} className={`h-9 px-2 text-sm text-neutral-400 hover:text-white disabled:opacity-0`}>Back</button>{invoiceStep === 0 ? <button type="button" disabled={pending} onClick={nextFromRelationship} className="h-10 rounded-lg bg-white px-4 text-sm font-semibold text-black disabled:opacity-50">{pending ? "Saving…" : "Review onboarding"}</button> : invoiceStep === 1 ? <button type="button" disabled={pending || onboardingIssues.length > 0} onClick={() => { setInvoiceStep(2); setError(null) }} className="h-10 rounded-lg bg-white px-4 text-sm font-semibold text-black disabled:opacity-40">Review pricing</button> : <button type="button" disabled={pending || pricingIssues.length > 0} onClick={invoiceClient} className="h-10 rounded-lg bg-white px-4 text-sm font-semibold text-black disabled:opacity-40">{pending ? "Sending invoice…" : "Invoice Client"}</button>}</footer>
        </section>
    </div>, parentDocument.body) : null

    const preview = previewModule && parentDocument ? createPortal(<div className="fixed inset-0 z-[150] flex flex-col bg-black text-white"><header className="flex h-14 shrink-0 items-center justify-between border-b border-neutral-800 bg-black px-4"><div><p className="text-sm font-medium">{previewModule.name}</p><p className="text-[11px] text-neutral-500">Client preview · nothing is saved</p></div><button type="button" onClick={() => setPreviewModule(null)} className="h-9 rounded-lg border border-neutral-700 px-3 text-xs">Back to invoice review</button></header><div className="min-h-0 flex-1"><BuilderPreview module={previewModule} theme={theme} help={help} workspaceName={workspaceName} /></div></div>, parentDocument.body) : null

    return <>
        {detailsPanel}
        {frozenInvoiceNotice}
        <div className="mt-5"><RelationshipGantt workspaceSlug={workspaceSlug} relationshipId={relationshipId} plan={plan} canEdit={canEdit} currentWork={currentWork} onInvoiceRequest={openInvoiceReview} /></div>
        {modal}
        {preview}
        {notice ? <WorkspaceSuccessNotice label={notice.label} actionLabel={notice.href ? "Open invoice" : undefined} onAction={notice.href ? navigateToInvoice : undefined} /> : null}
    </>
}
