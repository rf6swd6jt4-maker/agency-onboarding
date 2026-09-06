"use client"

import { Suspense, use, useCallback, useEffect, useRef, useState, useTransition } from "react"
import { createPortal } from "react-dom"
import { useRouter } from "next/navigation"
import Image from "next/image"
import { BuilderPreview } from "@/components/onboarding-builder/BuilderPreview"
import { DetailContentLoading, DetailField, DetailFields } from "@/components/detail"
import { RoundPill, SquarePill } from "@/components/ui"
import { WorkspaceSuccessNotice } from "@/components/workspace/WorkspaceSuccessNotice"
import type { OnboardingPaymentDefinitionV2 } from "@/lib/onboarding/block-definition"
import type { OnboardingHelpSettings, OnboardingModuleDefinition, OnboardingThemeDefinition } from "@/lib/onboarding/configuration-types"
import type { RelationshipPhase } from "@/lib/relationship-phases"
import type { RelationshipGanttPlan } from "@/lib/relationship-gantt"
import { postGanttSync } from "@/lib/ui/gantt-sync"
import { registerWorkspaceAutosaveFlusher, runWorkspaceMutation } from "@/lib/workspace-mutations"
import { isUsablePhoneNumber, resolvePrimaryMessagingProvider } from "@/lib/client-messages/addresses"
import { proceedRelationshipCurrentWork, saveRelationshipBackgroundDetails, saveRelationshipDealDetails, type RelationshipDealDetailsInput } from "../actions"
import { RelationshipGantt } from "./RelationshipGantt"

type Member = { id: string; name: string }
type FulfilmentTeam = { id: string; name: string; responsibilities: Array<{ serviceId: string; userId: string }> }
type DealService = {
    code: string
    serviceId: string | null
    revisionId: string | null
    name: string
    description: string
    serviceType: "one_time" | "retainer"
    recurringName: string
    recurringDescription: string
    defaultBillingInterval: "week" | "month" | "year"
    defaultBillingIntervalCount: number
    thumbnailUrl: string | null
    defaultUpfrontPriceCents: number
    defaultRecurringPriceCents: number
    currency: string
    isTest: boolean
    revisionNumber: number | null
    selected: boolean
    selectedUpfrontPriceCents: number
    selectedRecurringPriceCents: number
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
    communicationPrimaryProvider: "meta_whatsapp" | "twilio_sms"
    communicationDeliveryMode: "primary_only" | "primary_with_fallback" | "mirror"
    primaryEmail: string
    sellerUserId: string
    fulfilmentManagerUserId: string
    fulfilmentTeamId: string
    projectTimeframeDays: number | null
    description: string
    lifecyclePhase: RelationshipPhase
}
type CurrentWork = { id: string; title: string; action: string | null; role: string; status: string; unassignedCount: number; blocked: boolean }
type Draft = Omit<RelationshipDetails, "lifecyclePhase"> & {
    selectedCodes: string[]
    upfrontPrices: Record<string, number>
    recurringPrices: Record<string, number>
    currency: string
    billingInterval: "week" | "month" | "year"
    billingIntervalCount: number
}

const inputClass = "min-h-7 w-full min-w-0 bg-transparent text-sm text-neutral-200 outline-none placeholder:text-neutral-700 focus:text-white"

function missingText(value: string, message: string) {
    return value.trim() ? null : message
}

function emailIssue(value: string) {
    if (!value.trim()) return "Billing email required"
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim()) ? null : "Enter a usable billing email"
}

function phoneIssue(value: string, label: string) {
    if (!value.trim()) return null
    return isUsablePhoneNumber(value) ? null : `Enter a usable ${label} number`
}

function messagingPhoneIssue(smsPhone: string, whatsappPhone: string) {
    return isUsablePhoneNumber(smsPhone) || isUsablePhoneNumber(whatsappPhone)
        ? null
        : "Add an SMS or WhatsApp number"
}

function priceLabel(cents: number, currency: string) {
    try {
        return new Intl.NumberFormat("en-IE", { style: "currency", currency: currency.toUpperCase() }).format(cents / 100)
    } catch {
        return `${currency.toUpperCase()} ${(cents / 100).toFixed(2)}`
    }
}

function intervalCountMaximum(interval: Draft["billingInterval"]) {
    return interval === "year" ? 3 : interval === "month" ? 36 : 156
}

function buildInitialDraft(details: RelationshipDetails, services: DealService[]): Draft {
    const selected = services.filter((service) => service.selected)
    const defaultRetainer = selected.find((service) => service.serviceType === "retainer")
        ?? services.find((service) => service.serviceType === "retainer")
    return {
        primaryPersonName: details.primaryPersonName,
        businessName: details.businessName,
        primaryContactRole: details.primaryContactRole,
        primaryPhone: details.primaryPhone,
        whatsappPhone: details.whatsappPhone,
        communicationPrimaryProvider: resolvePrimaryMessagingProvider({
            requestedProvider: details.communicationPrimaryProvider,
            smsPhone: details.primaryPhone,
            whatsappPhone: details.whatsappPhone,
        }),
        communicationDeliveryMode: details.communicationDeliveryMode,
        primaryEmail: details.primaryEmail,
        sellerUserId: details.sellerUserId,
        fulfilmentManagerUserId: details.fulfilmentManagerUserId,
        fulfilmentTeamId: details.fulfilmentTeamId,
        projectTimeframeDays: details.projectTimeframeDays,
        description: details.description,
        selectedCodes: selected.map((service) => service.code),
        upfrontPrices: Object.fromEntries(services.map((service) => [service.code, service.selected ? service.selectedUpfrontPriceCents : service.defaultUpfrontPriceCents])),
        recurringPrices: Object.fromEntries(services.map((service) => [service.code, service.serviceType === "retainer" ? (service.selected ? service.selectedRecurringPriceCents : service.defaultRecurringPriceCents) : 0])),
        currency: selected[0]?.selectedCurrency ?? services[0]?.currency ?? "USD",
        billingInterval: defaultRetainer?.defaultBillingInterval ?? "month",
        billingIntervalCount: defaultRetainer?.defaultBillingIntervalCount ?? 1,
    }
}

function backgroundDetailsKey(draft: Draft) {
    return JSON.stringify({
        primaryPersonName: draft.primaryPersonName,
        businessName: draft.businessName,
        primaryContactRole: draft.primaryContactRole,
        primaryPhone: draft.primaryPhone,
        whatsappPhone: draft.whatsappPhone,
        communicationPrimaryProvider: draft.communicationPrimaryProvider,
        communicationDeliveryMode: draft.communicationDeliveryMode,
        primaryEmail: draft.primaryEmail,
        description: draft.description,
    })
}

function commercialDetailsKey(draft: Draft) {
    return JSON.stringify({
        sellerUserId: draft.sellerUserId,
        fulfilmentManagerUserId: draft.fulfilmentManagerUserId,
        fulfilmentTeamId: draft.fulfilmentTeamId,
        projectTimeframeDays: draft.projectTimeframeDays,
        selectedCodes: draft.selectedCodes,
        upfrontPrices: draft.upfrontPrices,
        recurringPrices: draft.recurringPrices,
        currency: draft.currency,
        billingInterval: draft.billingInterval,
        billingIntervalCount: draft.billingIntervalCount,
    })
}

function MissingHint({ message }: { message: string | null }) {
    return message ? <span className="mt-1 block text-[11px] text-amber-300">{message}</span> : null
}

function RelationshipGanttContent({ workspaceSlug, relationshipId, planPromise, canEdit, currentWork, userId, onInvoiceRequest }: {
    workspaceSlug: string
    relationshipId: string
    planPromise: Promise<RelationshipGanttPlan>
    canEdit: boolean
    currentWork: CurrentWork | null
    userId: string
    onInvoiceRequest: () => void
}) {
    const plan = use(planPromise)
    const fallbackCurrentWork = plan.items.find((item) => (
        item.workflowRole === "lifecycle_stage"
        && !["done", "canceled"].includes(item.status)
        && item.assignees.some((assignee) => assignee.userId === userId)
    ))
    const resolvedCurrentWork = currentWork ?? (fallbackCurrentWork ? {
        id: fallbackCurrentWork.id,
        title: fallbackCurrentWork.title,
        action: fallbackCurrentWork.workflowAction,
        role: fallbackCurrentWork.workflowRole,
        status: fallbackCurrentWork.status,
        unassignedCount: 0,
        blocked: false,
    } : null)

    return <RelationshipGantt workspaceSlug={workspaceSlug} relationshipId={relationshipId} plan={plan} canEdit={canEdit} currentWork={resolvedCurrentWork} onInvoiceRequest={onInvoiceRequest} />
}

export function RelationshipDealWorkspace({
    workspaceSlug,
    workspaceName,
    logoSrc,
    privacyPolicyUrl,
    termsOfServiceUrl,
    relationshipId,
    userId,
    updatedAt,
    details,
    members,
    fulfilmentTeams,
    services,
    modules,
    payment,
    theme,
    help,
    schemaReady,
    whatsappVerified,
    twilioVerified,
    commercialLocked,
    planPromise,
    canEdit,
    currentWork,
}: {
    workspaceSlug: string
    workspaceName: string
    logoSrc?: string | null
    privacyPolicyUrl?: string | null
    termsOfServiceUrl?: string | null
    relationshipId: string
    userId: string
    updatedAt: string
    details: RelationshipDetails
    members: Member[]
    fulfilmentTeams: FulfilmentTeam[]
    services: DealService[]
    modules: OnboardingModuleDefinition[]
    payment: OnboardingPaymentDefinitionV2
    theme: OnboardingThemeDefinition
    help: OnboardingHelpSettings
    schemaReady: boolean
    whatsappVerified: boolean
    twilioVerified: boolean
    commercialLocked: boolean
    planPromise: Promise<RelationshipGanttPlan>
    canEdit: boolean
    currentWork: CurrentWork | null
}) {
    const router = useRouter()
    const [draft, setDraft] = useState(() => buildInitialDraft(details, services))
    const [baseline, setBaseline] = useState(() => buildInitialDraft(details, services))
    const [servicesOpen, setServicesOpen] = useState(false)
    const [invoiceOpen, setInvoiceOpen] = useState(false)
    const [invoiceStep, setInvoiceStep] = useState(0)
    const [onboardingPreviewOpen, setOnboardingPreviewOpen] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [notice, setNotice] = useState<{ label: string } | null>(null)
    const [autosaveState, setAutosaveState] = useState<"idle" | "dirty" | "saving" | "saved" | "error">("idle")
    const [pending, startTransition] = useTransition()
    const latestDraftRef = useRef(draft)
    const initialBackgroundKey = backgroundDetailsKey(buildInitialDraft(details, services))
    const [savedBackgroundKey, setSavedBackgroundKey] = useState(initialBackgroundKey)
    const savedBackgroundKeyRef = useRef(initialBackgroundKey)
    const backgroundVersionRef = useRef(updatedAt)
    const autosaveTimerRef = useRef<number | null>(null)
    const autosavePromiseRef = useRef<Promise<boolean> | null>(null)
    const parentDocument = typeof window !== "undefined" && window.parent !== window ? window.parent.document : typeof document !== "undefined" ? document : null
    const selectedServices = services.filter((service) => draft.selectedCodes.includes(service.code))
    const selectedFulfilmentTeam = fulfilmentTeams.find((team) => team.id === draft.fulfilmentTeamId) ?? null
    const missingTeamServices = selectedFulfilmentTeam ? selectedServices.filter((service) => !service.serviceId || !selectedFulfilmentTeam.responsibilities.some((responsibility) => responsibility.serviceId === service.serviceId)) : selectedServices
    const selectedModuleIds = new Set([
        ...modules.filter((module) => module.mandatory).map((module) => module.id),
        ...selectedServices.flatMap((service) => service.moduleIds),
    ])
    // Published configuration is already in canonical composition order. Filtering
    // it preserves the same module sequence that a newly created session receives.
    const assignedModules = modules.filter((module) => selectedModuleIds.has(module.id))
    const primaryMessagingProvider = resolvePrimaryMessagingProvider({
        requestedProvider: draft.communicationPrimaryProvider,
        smsPhone: draft.primaryPhone,
        whatsappPhone: draft.whatsappPhone,
    })
    const smsPhoneAvailable = isUsablePhoneNumber(draft.primaryPhone)
    const whatsappPhoneAvailable = isUsablePhoneNumber(draft.whatsappPhone)
    const saleUsesSms = twilioVerified && smsPhoneAvailable && (
        primaryMessagingProvider === "twilio_sms" || draft.communicationDeliveryMode === "mirror"
    )
    const sendConfirmationLabel = `Send ${primaryMessagingProvider === "twilio_sms" ? "SMS" : "WhatsApp"} confirmation`
    const invoiced = ["sold", "invoiced", "onboarding", "onboarding_review", "fulfilment", "retention", "completed_lost"].includes(details.lifecyclePhase)
    const backgroundDirty = backgroundDetailsKey(draft) !== savedBackgroundKey
    const commercialDirty = commercialDetailsKey(draft) !== commercialDetailsKey(baseline)
    const relationshipIssues = [
        missingText(draft.primaryPersonName, "Client name required"),
        emailIssue(draft.primaryEmail),
        phoneIssue(draft.primaryPhone, "SMS"),
        phoneIssue(draft.whatsappPhone, "WhatsApp"),
        messagingPhoneIssue(draft.primaryPhone, draft.whatsappPhone),
        draft.selectedCodes.length ? null : "Select at least one service",
        draft.fulfilmentTeamId ? null : "Choose a fulfilment team",
        draft.fulfilmentTeamId && missingTeamServices.length ? `${selectedFulfilmentTeam?.name ?? "This team"} does not cover: ${missingTeamServices.map((service) => service.name).join(", ")}` : null,
    ].filter((issue): issue is string => Boolean(issue))
    const onboardingIssues = [
        schemaReady ? null : "The Builder schema is not available",
        primaryMessagingProvider === "twilio_sms"
            ? twilioVerified ? null : "The workspace Twilio connection is not verified"
            : whatsappVerified ? null : "The workspace WhatsApp connection is not verified",
        assignedModules.length ? null : "The selected services do not produce a published onboarding",
    ].filter((issue): issue is string => Boolean(issue))
    const pricingIssues = [
        /^[A-Z]{3}$/.test(draft.currency.toUpperCase()) ? null : "Use a three-letter currency code",
        selectedServices.some((service) => service.serviceType === "retainer" && (draft.recurringPrices[service.code] ?? 0) > 0) && (draft.billingIntervalCount < 1 || draft.billingIntervalCount > intervalCountMaximum(draft.billingInterval)) ? `Use a recurring interval between 1 and ${intervalCountMaximum(draft.billingInterval)}` : null,
        ...selectedServices.flatMap((service) => (draft.upfrontPrices[service.code] ?? 0) > 0 || (draft.recurringPrices[service.code] ?? 0) > 0 ? [] : [`Add an upfront or recurring price for ${service.name}`]),
    ].filter((issue): issue is string => Boolean(issue))
    const upfrontTotalCents = selectedServices.reduce((total, service) => total + (draft.upfrontPrices[service.code] ?? 0), 0)
    const recurringTotalCents = selectedServices.reduce((total, service) => total + (service.serviceType === "retainer" ? draft.recurringPrices[service.code] ?? 0 : 0), 0)
    const dueTodayCents = upfrontTotalCents + recurringTotalCents

    useEffect(() => {
        if (!notice) return
        const timeout = window.setTimeout(() => setNotice(null), 8400)
        return () => window.clearTimeout(timeout)
    }, [notice])

    useEffect(() => {
        latestDraftRef.current = draft
    }, [draft])

    const saveBackground = useCallback(async (): Promise<boolean> => {
        if (!canEdit) return true
        if (autosaveTimerRef.current) {
            window.clearTimeout(autosaveTimerRef.current)
            autosaveTimerRef.current = null
        }
        if (autosavePromiseRef.current) return autosavePromiseRef.current
        const drain = async () => {
            while (true) {
                const source = latestDraftRef.current
                const sourceKey = backgroundDetailsKey(source)
                if (sourceKey === savedBackgroundKeyRef.current) {
                    setAutosaveState("saved")
                    return true
                }
                if (!source.primaryPersonName.trim()) {
                    setAutosaveState("error")
                    setError("Add the client's name before saving the relationship")
                    return false
                }
                setAutosaveState("saving")
                setError(null)
                const outcome = await runWorkspaceMutation(() => saveRelationshipBackgroundDetails(workspaceSlug, relationshipId, {
                    primaryPersonName: source.primaryPersonName,
                    businessName: source.businessName,
                    primaryContactRole: source.primaryContactRole,
                    primaryPhone: source.primaryPhone,
                    whatsappPhone: source.whatsappPhone,
                    communicationPrimaryProvider: source.communicationPrimaryProvider,
                    communicationDeliveryMode: source.communicationDeliveryMode,
                    primaryEmail: source.primaryEmail,
                    description: source.description,
                    expectedUpdatedAt: backgroundVersionRef.current,
                }), { category: "services" })
                if (!outcome.ok) {
                    setAutosaveState("error")
                    setError(outcome.error)
                    return false
                }
                backgroundVersionRef.current = outcome.version
                savedBackgroundKeyRef.current = sourceKey
                setSavedBackgroundKey(sourceKey)
                setBaseline((current) => ({
                    ...current,
                    primaryPersonName: source.primaryPersonName,
                    businessName: source.businessName,
                    primaryContactRole: source.primaryContactRole,
                    primaryPhone: source.primaryPhone,
                    whatsappPhone: source.whatsappPhone,
                    communicationPrimaryProvider: source.communicationPrimaryProvider,
                    communicationDeliveryMode: source.communicationDeliveryMode,
                    primaryEmail: source.primaryEmail,
                    description: source.description,
                }))
                if (backgroundDetailsKey(latestDraftRef.current) === sourceKey) {
                    setAutosaveState("saved")
                    return true
                }
            }
        }
        autosavePromiseRef.current = drain().finally(() => {
            autosavePromiseRef.current = null
        })
        return autosavePromiseRef.current
    }, [canEdit, relationshipId, workspaceSlug])

    useEffect(() => {
        const unregister = registerWorkspaceAutosaveFlusher(async () => { await saveBackground() })
        return () => {
            unregister()
            if (autosaveTimerRef.current) window.clearTimeout(autosaveTimerRef.current)
        }
    }, [saveBackground])

    useEffect(() => {
        if (!canEdit || !backgroundDirty) return
        if (autosaveTimerRef.current) window.clearTimeout(autosaveTimerRef.current)
        autosaveTimerRef.current = window.setTimeout(() => void saveBackground(), 800)
        return () => {
            if (autosaveTimerRef.current) window.clearTimeout(autosaveTimerRef.current)
        }
    }, [backgroundDirty, canEdit, draft.primaryPersonName, draft.businessName, draft.primaryContactRole, draft.primaryPhone, draft.whatsappPhone, draft.communicationPrimaryProvider, draft.communicationDeliveryMode, draft.primaryEmail, draft.description, saveBackground])

    function update<K extends keyof Draft>(key: K, value: Draft[K]) {
        if (["primaryPersonName", "businessName", "primaryContactRole", "primaryPhone", "whatsappPhone", "communicationPrimaryProvider", "communicationDeliveryMode", "primaryEmail", "description"].includes(key)) {
            setAutosaveState("dirty")
            setError(null)
        }
        setDraft((current) => {
            const next = { ...current, [key]: value }
            if (key !== "primaryPhone" && key !== "whatsappPhone") return next
            return {
                ...next,
                communicationPrimaryProvider: resolvePrimaryMessagingProvider({
                    requestedProvider: next.communicationPrimaryProvider,
                    smsPhone: next.primaryPhone,
                    whatsappPhone: next.whatsappPhone,
                }),
            }
        })
    }

    function toggleService(code: string) {
        setDraft((current) => {
            const removing = current.selectedCodes.includes(code)
            const service = services.find((candidate) => candidate.code === code)
            const hasSelectedRetainer = services.some((candidate) => current.selectedCodes.includes(candidate.code) && candidate.serviceType === "retainer")
            return {
                ...current,
                selectedCodes: removing ? current.selectedCodes.filter((item) => item !== code) : [...current.selectedCodes, code],
                ...(!removing && service?.serviceType === "retainer" && !hasSelectedRetainer ? {
                    billingInterval: service.defaultBillingInterval,
                    billingIntervalCount: service.defaultBillingIntervalCount,
                } : {}),
            }
        })
    }

    function dealInput(source: Draft = draft): RelationshipDealDetailsInput {
        const sourceServices = services.filter((service) => source.selectedCodes.includes(service.code))
        const effectivePrimaryProvider = resolvePrimaryMessagingProvider({
            requestedProvider: source.communicationPrimaryProvider,
            smsPhone: source.primaryPhone,
            whatsappPhone: source.whatsappPhone,
        })
        return {
            primaryPersonName: source.primaryPersonName,
            businessName: source.businessName,
            primaryContactRole: source.primaryContactRole,
            primaryPhone: source.primaryPhone,
            whatsappPhone: source.whatsappPhone,
            communicationPrimaryProvider: effectivePrimaryProvider,
            communicationDeliveryMode: source.communicationDeliveryMode,
            primaryEmail: source.primaryEmail,
            sellerUserId: source.sellerUserId,
            fulfilmentManagerUserId: source.fulfilmentManagerUserId,
            fulfilmentTeamId: source.fulfilmentTeamId,
            projectTimeframeDays: source.projectTimeframeDays,
            description: source.description,
            services: sourceServices.map((service) => ({
                code: service.code,
                serviceId: service.serviceId,
                revisionId: service.revisionId,
                upfrontPriceCents: Math.max(0, Math.round(source.upfrontPrices[service.code] ?? 0)),
                recurringPriceCents: service.serviceType === "retainer" ? Math.max(0, Math.round(source.recurringPrices[service.code] ?? 0)) : 0,
                currency: source.currency.toUpperCase(),
                assigneeUserId: source.fulfilmentTeamId && service.serviceId ? fulfilmentTeams.find((team) => team.id === source.fulfilmentTeamId)?.responsibilities.find((responsibility) => responsibility.serviceId === service.serviceId)?.userId ?? null : service.selectedAssigneeId,
            })),
        }
    }

    async function saveDetails() {
        if (!await saveBackground()) return false
        const source = latestDraftRef.current
        const outcome = await runWorkspaceMutation(() => saveRelationshipDealDetails(workspaceSlug, relationshipId, dealInput(source)), { category: "services" })
        if (!outcome.ok) {
            setError(outcome.error)
            return false
        }
        backgroundVersionRef.current = outcome.version
        savedBackgroundKeyRef.current = backgroundDetailsKey(source)
        setBaseline(source)
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
        if (!currentWork || currentWork.action !== "sell_client") {
            setError("This relationship is no longer waiting to be sold. Reload and review its current stage.")
            return
        }
        if (pricingIssues.length) {
            setError(pricingIssues[0])
            return
        }
        startTransition(() => {
            void (async () => {
                if (!await saveDetails()) return
                const outcome = await runWorkspaceMutation(() => proceedRelationshipCurrentWork(workspaceSlug, relationshipId, currentWork.id, {
                    billingInterval: draft.billingInterval,
                    billingIntervalCount: draft.billingIntervalCount,
                }), { category: "billing" })
                if (!outcome.ok) {
                    setError(outcome.error)
                    return
                }
                setInvoiceOpen(false)
                if (outcome.sale?.kind === "sms") {
                    setNotice({ label: outcome.sale.sent ? "Client sold and SMS confirmation sent" : "Client sold and waiting for SMS opt-in" })
                } else {
                    setNotice({ label: "Confirmation sent via WhatsApp" })
                }
                router.refresh()
                postGanttSync(workspaceSlug)
            })().catch(() => setError("The client confirmation could not be sent. Please try again."))
        })
    }

    const detailsPanel = <div data-relationship-details>
        <DetailFields>
            <DetailField label="Name" icon="identity"><input disabled={!canEdit} value={draft.primaryPersonName} onChange={(event) => update("primaryPersonName", event.target.value)} onBlur={() => void saveBackground()} placeholder="Client name" className={inputClass} /></DetailField>
            <DetailField label="Company" icon="identity" className="lg:border-l lg:border-neutral-900 lg:pl-8"><input disabled={!canEdit} value={draft.businessName} onChange={(event) => update("businessName", event.target.value)} onBlur={() => void saveBackground()} placeholder="No company" className={inputClass} /></DetailField>
            <DetailField label="Role" icon="identity"><input disabled={!canEdit} value={draft.primaryContactRole} onChange={(event) => update("primaryContactRole", event.target.value)} onBlur={() => void saveBackground()} placeholder="Not set" className={inputClass} /></DetailField>
            <DetailField label="SMS number" icon="contact" className="lg:border-l lg:border-neutral-900 lg:pl-8"><input disabled={!canEdit} type="tel" value={draft.primaryPhone} onChange={(event) => update("primaryPhone", event.target.value)} onBlur={() => void saveBackground()} placeholder="Not set" className={inputClass} /></DetailField>
            <DetailField label="WhatsApp" icon="contact"><input disabled={!canEdit} type="tel" value={draft.whatsappPhone} onChange={(event) => update("whatsappPhone", event.target.value)} onBlur={() => void saveBackground()} placeholder="Optional alternate channel" className={inputClass} /></DetailField>
            <DetailField label="Email" icon="contact" className="lg:border-l lg:border-neutral-900 lg:pl-8"><input disabled={!canEdit} type="email" value={draft.primaryEmail} onChange={(event) => update("primaryEmail", event.target.value)} onBlur={() => void saveBackground()} placeholder="Required before selling" className={inputClass} /></DetailField>
            <DetailField label="Primary messaging" icon="contact"><select disabled={!canEdit} value={draft.communicationPrimaryProvider} onChange={(event) => update("communicationPrimaryProvider", event.target.value as Draft["communicationPrimaryProvider"])} onBlur={() => void saveBackground()} className={inputClass}><option value="twilio_sms" disabled={!smsPhoneAvailable}>SMS (Twilio)</option><option value="meta_whatsapp" disabled={!whatsappPhoneAvailable}>WhatsApp</option></select></DetailField>
            <DetailField label="Outbound delivery" icon="contact" className="lg:border-l lg:border-neutral-900 lg:pl-8"><select disabled={!canEdit} value={draft.communicationDeliveryMode} onChange={(event) => update("communicationDeliveryMode", event.target.value as Draft["communicationDeliveryMode"])} onBlur={() => void saveBackground()} className={inputClass}><option value="mirror">Send to every connected channel</option><option value="primary_with_fallback">Primary, or fallback if unavailable</option><option value="primary_only">Primary only</option></select></DetailField>
            <DetailField label="Seller" icon="person"><select disabled={!canEdit} value={draft.sellerUserId} onChange={(event) => update("sellerUserId", event.target.value)} className={inputClass}><option value="">Unassigned</option>{members.map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}</select></DetailField>
            <DetailField label="Fulfilment manager" icon="person" className="lg:border-l lg:border-neutral-900 lg:pl-8"><select disabled={!canEdit} value={draft.fulfilmentManagerUserId} onChange={(event) => update("fulfilmentManagerUserId", event.target.value)} className={inputClass}><option value="">Choose before fulfilment</option>{members.map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}</select></DetailField>
            <DetailField label="Fulfilment team" icon="person" className="lg:col-span-2"><select disabled={!canEdit || commercialLocked} value={draft.fulfilmentTeamId} onChange={(event) => update("fulfilmentTeamId", event.target.value)} className={inputClass}><option value="">Choose fulfilment team</option>{fulfilmentTeams.map((team) => { const missing = selectedServices.filter((service) => !service.serviceId || !team.responsibilities.some((responsibility) => responsibility.serviceId === service.serviceId)); return <option key={team.id} value={team.id} disabled={missing.length > 0}>{team.name}{missing.length ? ` · missing ${missing.map((service) => service.name).join(", ")}` : ""}</option> })}</select>{draft.fulfilmentTeamId && missingTeamServices.length ? <MissingHint message={`${selectedFulfilmentTeam?.name ?? "This team"} does not cover ${missingTeamServices.map((service) => service.name).join(", ")}.`} /> : null}</DetailField>
            <DetailField label={invoiced ? "Project timeline" : "Planned project timeline"} icon="timeline" className="lg:col-span-2"><div className="flex items-center gap-2"><input disabled={!canEdit} type="number" min="1" value={draft.projectTimeframeDays ?? ""} onChange={(event) => update("projectTimeframeDays", event.target.value ? Number(event.target.value) : null)} placeholder="Not set" className={`${inputClass} max-w-24`} />{draft.projectTimeframeDays ? <span className="text-neutral-500">days</span> : null}</div></DetailField>
        <DetailField label="Services" icon="services" className="lg:col-span-2">
            <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                {selectedServices.map((service) => <RoundPill key={service.code} tone="emerald">{service.name}</RoundPill>)}
                {!selectedServices.length ? <span className="text-neutral-600">None</span> : null}
                {canEdit && !commercialLocked ? <button type="button" onClick={() => setServicesOpen((open) => !open)} className="ml-auto text-xs text-neutral-400 underline underline-offset-4 hover:text-white">{servicesOpen ? "Done" : "Edit services"}</button> : null}
            </div>
            {servicesOpen && !commercialLocked ? <div className="mt-2 grid gap-1.5 rounded-lg border border-neutral-800 bg-neutral-950 p-2 sm:grid-cols-2 lg:grid-cols-3">{services.map((service) => <label key={service.code} className="flex items-start gap-2 rounded-md px-2 py-2 text-sm hover:bg-neutral-900"><input type="checkbox" checked={draft.selectedCodes.includes(service.code)} onChange={() => toggleService(service.code)} className="mt-0.5" /><span className="min-w-0"><span className="flex items-center gap-1.5"><span className="truncate text-neutral-200">{service.name}</span>{service.isTest ? <SquarePill tone="yellow">Test</SquarePill> : null}</span><span className="mt-0.5 block truncate text-[11px] text-neutral-600">{service.revisionNumber ? `Revision ${service.revisionNumber}` : service.code}</span></span></label>)}</div> : null}
        </DetailField>
        <DetailField label="Description" icon="description" className="lg:col-span-2"><textarea disabled={!canEdit} value={draft.description} onChange={(event) => update("description", event.target.value)} onBlur={() => void saveBackground()} rows={3} placeholder="Add relationship context…" className={`${inputClass} min-h-20 resize-none leading-6`} /></DetailField>
        </DetailFields>
        {error && !invoiceOpen ? <p className="border-t border-red-500/20 py-2 text-sm text-red-300">{error}</p> : null}
        {canEdit ? <div className="flex items-center justify-between gap-3 border-t border-neutral-900 py-2.5"><span aria-live="polite" className={`text-xs ${autosaveState === "error" ? "text-red-300" : "text-neutral-500"}`}>{autosaveState === "saving" ? "Saving relationship details…" : autosaveState === "error" ? "Relationship details could not save automatically" : backgroundDirty ? "Relationship details will save automatically" : autosaveState === "saved" ? "Relationship details saved" : "Relationship details save automatically"}</span>{autosaveState === "error" ? <button type="button" onClick={() => void saveBackground()} className="text-xs text-red-200 underline decoration-red-500/50 underline-offset-2 hover:text-white">Retry</button> : commercialDirty ? <div className="flex justify-end gap-2"><button type="button" disabled={pending} onClick={() => { setDraft((current) => ({ ...baseline, primaryPersonName: current.primaryPersonName, businessName: current.businessName, primaryContactRole: current.primaryContactRole, primaryPhone: current.primaryPhone, whatsappPhone: current.whatsappPhone, primaryEmail: current.primaryEmail, description: current.description })); setServicesOpen(false); setError(null) }} className="h-8 px-2 text-xs text-neutral-400 hover:text-white disabled:opacity-50">Cancel</button><button type="button" disabled={pending} onClick={() => startTransition(() => { void saveDetails() })} className="h-8 rounded-md bg-white px-3 text-xs font-medium text-black disabled:opacity-50">{pending ? "Saving…" : "Save commercial changes"}</button></div> : null}</div> : null}
    </div>

    const modal = invoiceOpen && parentDocument ? createPortal(<div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/75 p-3 text-white backdrop-blur-sm">
        <section role="dialog" aria-modal="true" aria-labelledby="invoice-review-title" className="betelgeze-popup-enter flex max-h-[min(92dvh,56rem)] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-neutral-700 bg-neutral-950 shadow-2xl shadow-black/70">
            <header className="shrink-0 border-b border-neutral-800 px-4 py-4 sm:px-6">
                <div className="flex items-start justify-between gap-4"><div><p className="text-xs font-medium uppercase tracking-[0.16em] text-neutral-500">Sell client</p><h2 id="invoice-review-title" className="mt-1 text-xl font-semibold">{invoiceStep === 0 ? "Review Relationship Information" : invoiceStep === 1 ? "Review Onboarding" : "Pricing"}</h2><p className="mt-1 text-sm text-neutral-500">{invoiceStep === 0 ? "Double-check the client's details and the services they are buying." : invoiceStep === 1 ? "Confirm the published onboarding this client will receive." : "Review each service's upfront and ongoing charges."}</p></div><button type="button" aria-label="Close sale review" onClick={() => { setInvoiceOpen(false); setError(null) }} className="text-neutral-500 hover:text-white">✕</button></div>
                <div className="mt-4 grid grid-cols-3 gap-2" aria-label={`Step ${invoiceStep + 1} of 3`}>{["Relationship", "Onboarding", "Pricing"].map((label, index) => <div key={label}><div className={`h-1 rounded-full ${index <= invoiceStep ? "bg-white" : "bg-neutral-800"}`} /><p className={`mt-1.5 text-[11px] ${index === invoiceStep ? "text-white" : "text-neutral-600"}`}>{index + 1}. {label}</p></div>)}</div>
            </header>
            <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-6 sm:py-5">
                {invoiceStep === 0 ? <div className="grid gap-3 sm:grid-cols-2">
                    <label className="text-xs text-neutral-500">Name<input value={draft.primaryPersonName} onChange={(event) => update("primaryPersonName", event.target.value)} className="mt-1.5 h-10 w-full rounded-lg border border-neutral-700 bg-black px-3 text-sm text-white" /><MissingHint message={missingText(draft.primaryPersonName, "Required")} /></label>
                    <label className="text-xs text-neutral-500">Company<input value={draft.businessName} onChange={(event) => update("businessName", event.target.value)} placeholder="Optional" className="mt-1.5 h-10 w-full rounded-lg border border-neutral-700 bg-black px-3 text-sm text-white" /></label>
                    <label className="text-xs text-neutral-500">Role<input value={draft.primaryContactRole} onChange={(event) => update("primaryContactRole", event.target.value)} placeholder="Optional" className="mt-1.5 h-10 w-full rounded-lg border border-neutral-700 bg-black px-3 text-sm text-white" /></label>
                    <label className="text-xs text-neutral-500">SMS number<input type="tel" value={draft.primaryPhone} onChange={(event) => update("primaryPhone", event.target.value)} placeholder="Optional" className="mt-1.5 h-10 w-full rounded-lg border border-neutral-700 bg-black px-3 text-sm text-white" /><MissingHint message={phoneIssue(draft.primaryPhone, "SMS")} /></label>
                    <label className="text-xs text-neutral-500">WhatsApp number<input type="tel" value={draft.whatsappPhone} onChange={(event) => update("whatsappPhone", event.target.value)} placeholder="Optional alternate channel" className="mt-1.5 h-10 w-full rounded-lg border border-neutral-700 bg-black px-3 text-sm text-white" /><MissingHint message={phoneIssue(draft.whatsappPhone, "WhatsApp")} /></label>
                    <label className="text-xs text-neutral-500">Primary messaging<select value={draft.communicationPrimaryProvider} onChange={(event) => update("communicationPrimaryProvider", event.target.value as Draft["communicationPrimaryProvider"])} className="mt-1.5 h-10 w-full rounded-lg border border-neutral-700 bg-black px-3 text-sm text-white"><option value="twilio_sms" disabled={!smsPhoneAvailable}>SMS (Twilio)</option><option value="meta_whatsapp" disabled={!whatsappPhoneAvailable}>WhatsApp</option></select><MissingHint message={messagingPhoneIssue(draft.primaryPhone, draft.whatsappPhone)} /></label>
                    <label className="text-xs text-neutral-500">Outbound delivery<select value={draft.communicationDeliveryMode} onChange={(event) => update("communicationDeliveryMode", event.target.value as Draft["communicationDeliveryMode"])} className="mt-1.5 h-10 w-full rounded-lg border border-neutral-700 bg-black px-3 text-sm text-white"><option value="mirror">Every connected channel</option><option value="primary_with_fallback">Primary with fallback</option><option value="primary_only">Primary only</option></select></label>
                    <label className="text-xs text-neutral-500">Billing email<input type="email" value={draft.primaryEmail} onChange={(event) => update("primaryEmail", event.target.value)} className="mt-1.5 h-10 w-full rounded-lg border border-neutral-700 bg-black px-3 text-sm text-white" /><MissingHint message={emailIssue(draft.primaryEmail)} /></label>
                    <label className="text-xs text-neutral-500">Seller<select value={draft.sellerUserId} onChange={(event) => update("sellerUserId", event.target.value)} className="mt-1.5 h-10 w-full rounded-lg border border-neutral-700 bg-black px-3 text-sm text-white"><option value="">Unassigned</option>{members.map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}</select></label>
                    <label className="text-xs text-neutral-500">Fulfilment manager<select value={draft.fulfilmentManagerUserId} onChange={(event) => update("fulfilmentManagerUserId", event.target.value)} className="mt-1.5 h-10 w-full rounded-lg border border-neutral-700 bg-black px-3 text-sm text-white"><option value="">Choose before fulfilment</option>{members.map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}</select></label>
                    <label className="text-xs text-neutral-500">Fulfilment team<select value={draft.fulfilmentTeamId} onChange={(event) => update("fulfilmentTeamId", event.target.value)} className="mt-1.5 h-10 w-full rounded-lg border border-neutral-700 bg-black px-3 text-sm text-white"><option value="">Choose team</option>{fulfilmentTeams.map((team) => { const missing = selectedServices.filter((service) => !service.serviceId || !team.responsibilities.some((responsibility) => responsibility.serviceId === service.serviceId)); return <option key={team.id} value={team.id} disabled={missing.length > 0}>{team.name}{missing.length ? ` · incomplete` : ""}</option> })}</select><MissingHint message={!draft.fulfilmentTeamId ? "Required" : missingTeamServices.length ? `${selectedFulfilmentTeam?.name ?? "Team"} does not cover every selected service` : null} /></label>
                    <label className="text-xs text-neutral-500">Planned project timeline<div className="mt-1.5 flex h-10 items-center rounded-lg border border-neutral-700 bg-black px-3"><input type="number" min="1" value={draft.projectTimeframeDays ?? ""} onChange={(event) => update("projectTimeframeDays", event.target.value ? Number(event.target.value) : null)} placeholder="Optional" className="min-w-0 flex-1 bg-transparent text-sm text-white outline-none" />{draft.projectTimeframeDays ? <span className="text-xs text-neutral-500">days</span> : null}</div></label>
                    <div className="sm:col-span-2"><p className="text-xs text-neutral-500">Services</p><div className="mt-1.5 grid gap-1.5 rounded-lg border border-neutral-800 bg-black p-2 sm:grid-cols-2">{services.map((service) => <label key={service.code} className="flex items-start gap-2 rounded-md px-2 py-2 hover:bg-neutral-900"><input type="checkbox" checked={draft.selectedCodes.includes(service.code)} onChange={() => toggleService(service.code)} className="mt-0.5" /><span className="min-w-0"><span className="flex items-center gap-1.5 text-sm text-neutral-200">{service.name}{service.isTest ? <SquarePill tone="yellow">Test</SquarePill> : null}</span><span className="mt-0.5 block text-[11px] text-neutral-600">{service.description || `Service ${service.code}`}</span></span></label>)}</div><MissingHint message={draft.selectedCodes.length ? null : "Select at least one service"} /></div>
                    <label className="text-xs text-neutral-500 sm:col-span-2">Description<textarea value={draft.description} onChange={(event) => update("description", event.target.value)} rows={3} placeholder="Optional relationship context" className="mt-1.5 min-h-20 w-full resize-none rounded-lg border border-neutral-700 bg-black px-3 py-2 text-sm leading-6 text-white" /></label>
                </div> : null}
                {invoiceStep === 1 ? <div className="space-y-3">
                    {onboardingIssues.length ? <div className="rounded-lg border border-amber-500/25 bg-amber-950/15 px-3 py-2.5 text-xs leading-5 text-amber-200">{onboardingIssues.map((issue) => <p key={issue}>{issue}</p>)}</div> : null}
                    <div className="flex items-center justify-between gap-3">
                        <div><p className="text-sm font-medium text-neutral-200">Client onboarding</p><p className="mt-0.5 text-xs text-neutral-600">{assignedModules.length} module{assignedModules.length === 1 ? "" : "s"} · {assignedModules.reduce((count, module) => count + module.steps.length, 0)} onboarding steps</p></div>
                        <button type="button" disabled={!assignedModules.length} onClick={() => setOnboardingPreviewOpen(true)} className="h-9 shrink-0 rounded-lg border border-neutral-700 px-3 text-xs font-medium text-neutral-100 hover:border-neutral-500 disabled:cursor-not-allowed disabled:opacity-40">Preview onboarding</button>
                    </div>
                    <div className="divide-y divide-neutral-900 overflow-hidden rounded-xl border border-neutral-800 bg-black">{assignedModules.map((module, index) => <div key={module.id} className="flex items-center gap-3 px-3 py-3"><span className="w-5 shrink-0 text-center text-xs tabular-nums text-neutral-600">{index + 1}</span><div className="min-w-0 flex-1"><RoundPill tone="sky">{module.name}</RoundPill><p className="mt-1.5 text-xs text-neutral-600">{module.steps.length} step{module.steps.length === 1 ? "" : "s"}{module.mandatory ? " · mandatory" : " · selected service"}</p></div></div>)}</div>
                </div> : null}
                {invoiceStep === 2 ? <div className="space-y-4">
                    <div className="flex flex-col justify-between gap-3 rounded-xl border border-neutral-800 bg-black p-3 sm:flex-row sm:items-end">
                        <label className="text-xs text-neutral-500">Currency<input value={draft.currency} onChange={(event) => update("currency", event.target.value.toUpperCase().slice(0, 3))} maxLength={3} className="mt-1.5 h-9 w-24 rounded-lg border border-neutral-700 bg-neutral-950 px-3 text-sm uppercase text-white" /></label>
                        {recurringTotalCents > 0 ? <div className="flex gap-2">
                            <label className="text-xs text-neutral-500">Repeat every<input type="number" min="1" max={intervalCountMaximum(draft.billingInterval)} value={draft.billingIntervalCount} onChange={(event) => update("billingIntervalCount", Math.max(1, Math.min(intervalCountMaximum(draft.billingInterval), Math.round(Number(event.target.value) || 1))))} className="mt-1.5 h-9 w-20 rounded-lg border border-neutral-700 bg-neutral-950 px-2 text-sm text-white" /></label>
                            <label className="text-xs text-neutral-500">Period<select value={draft.billingInterval} onChange={(event) => { const interval = event.target.value as Draft["billingInterval"]; setDraft((current) => ({ ...current, billingInterval: interval, billingIntervalCount: Math.min(current.billingIntervalCount, intervalCountMaximum(interval)) })) }} className="mt-1.5 h-9 rounded-lg border border-neutral-700 bg-neutral-950 px-3 text-sm text-white"><option value="week">Week(s)</option><option value="month">Month(s)</option><option value="year">Year(s)</option></select></label>
                        </div> : <p className="max-w-md text-xs leading-5 text-neutral-600">No recurring charges are currently included. Checkout will collect the upfront total once.</p>}
                    </div>
                    <div className="divide-y divide-neutral-900 overflow-hidden rounded-xl border border-neutral-800 bg-black">{selectedServices.map((service) => <div key={service.code} className={`grid gap-3 px-3 py-3 sm:items-center ${service.serviceType === "retainer" ? "sm:grid-cols-[3rem_minmax(0,1fr)_8rem_8rem]" : "sm:grid-cols-[3rem_minmax(0,1fr)_8rem]"}`}>
                        <div className="flex h-12 w-12 items-center justify-center overflow-hidden rounded-lg border border-neutral-800 bg-neutral-900 text-[9px] uppercase tracking-wide text-neutral-600">{service.thumbnailUrl ? <Image src={service.thumbnailUrl} alt="" width={48} height={48} unoptimized className="h-full w-full object-cover" /> : "Service"}</div>
                        <div className="min-w-0"><p className="truncate text-sm font-medium text-neutral-100">{service.name}</p><p className="mt-1 line-clamp-2 text-xs leading-5 text-neutral-600">{service.description || "Client-facing service"}</p>{service.serviceType === "retainer" ? <p className="mt-1 truncate text-xs text-neutral-400">Recurring: {service.recurringName}</p> : null}</div>
                        <label className="text-xs text-neutral-500">{service.serviceType === "retainer" ? "Upfront" : "One-time"}<input type="number" min="0" step="0.01" value={(draft.upfrontPrices[service.code] ?? 0) / 100} onChange={(event) => setDraft((current) => ({ ...current, upfrontPrices: { ...current.upfrontPrices, [service.code]: Math.round(Number(event.target.value || 0) * 100) } }))} className="mt-1 h-9 w-full rounded-lg border border-neutral-700 bg-neutral-950 px-2 text-sm text-white" /></label>
                        {service.serviceType === "retainer" ? <label className="text-xs text-neutral-500">Recurring<input type="number" min="0" step="0.01" value={(draft.recurringPrices[service.code] ?? 0) / 100} onChange={(event) => setDraft((current) => ({ ...current, recurringPrices: { ...current.recurringPrices, [service.code]: Math.round(Number(event.target.value || 0) * 100) } }))} className="mt-1 h-9 w-full rounded-lg border border-neutral-700 bg-neutral-950 px-2 text-sm text-white" /></label> : null}
                    </div>)}</div>
                    <div className="grid gap-3 border-t border-neutral-800 pt-4 sm:grid-cols-3"><div><p className="text-xs text-neutral-500">Upfront fees</p><p className="mt-1 text-lg font-semibold">{priceLabel(upfrontTotalCents, draft.currency)}</p></div><div><p className="text-xs text-neutral-500">Recurring total</p><p className="mt-1 text-lg font-semibold">{priceLabel(recurringTotalCents, draft.currency)}</p></div><div className="sm:text-right"><p className="text-xs text-neutral-500">Due at Checkout</p><p className="mt-1 text-2xl font-semibold">{priceLabel(dueTodayCents, draft.currency)}</p></div></div>
                    <p className="text-right text-xs leading-5 text-neutral-600">Due at Checkout includes the upfront fees and the first recurring period. Sending the client confirmation freezes these services, prices and onboarding.</p>
                </div> : null}
                {error ? <p role="alert" className="mt-4 rounded-lg border border-red-500/20 bg-red-950/20 px-3 py-2.5 text-sm text-red-300">{error}</p> : null}
            </div>
            <footer className="flex shrink-0 items-center justify-between gap-3 border-t border-neutral-800 px-4 py-3 sm:px-6"><button type="button" disabled={invoiceStep === 0 || pending} onClick={() => { setInvoiceStep((step) => Math.max(0, step - 1)); setError(null) }} className="h-9 px-2 text-sm text-neutral-400 hover:text-white disabled:opacity-0">Back</button>{invoiceStep === 0 ? <button type="button" disabled={pending} onClick={nextFromRelationship} className="h-10 rounded-lg bg-white px-4 text-sm font-semibold text-black disabled:opacity-50">{pending ? "Saving…" : "Review onboarding"}</button> : invoiceStep === 1 ? <button type="button" disabled={pending || onboardingIssues.length > 0} onClick={() => { setInvoiceStep(2); setError(null) }} className="h-10 rounded-lg bg-white px-4 text-sm font-semibold text-black disabled:opacity-40">Review pricing</button> : <button type="button" disabled={pending || pricingIssues.length > 0} onClick={invoiceClient} className="h-10 rounded-lg bg-white px-4 text-sm font-semibold text-black disabled:opacity-40">{pending ? "Selling…" : saleUsesSms ? "Sell and send SMS" : sendConfirmationLabel}</button>}</footer>
        </section>
    </div>, parentDocument.body) : null

    const preview = onboardingPreviewOpen && parentDocument ? createPortal(<div data-pos-onboarding-preview className="betelgeze-popup-fade fixed inset-0 z-[2147483646] overflow-hidden bg-neutral-100 text-white">
        <div className="pointer-events-none absolute inset-x-0 top-0 z-20 flex items-start p-3 sm:p-4">
            <button type="button" onClick={() => setOnboardingPreviewOpen(false)} className="pointer-events-auto rounded-full border border-white/20 bg-neutral-700 px-5 py-2.5 text-sm font-semibold text-white shadow-[0_8px_20px_rgba(0,0,0,0.24)] transition hover:bg-neutral-600 focus:outline-none focus:ring-2 focus:ring-white/70">Exit preview</button>
        </div>
        <div className="h-full min-h-0"><BuilderPreview fullWindow modules={assignedModules} payment={payment} theme={theme} help={help} workspaceName={workspaceName} logoSrc={logoSrc} client={{ name: draft.primaryPersonName || "Preview client", email: draft.primaryEmail || null, phone: draft.primaryPhone || draft.whatsappPhone || null, isTest: false }} privacyPolicyUrl={privacyPolicyUrl} termsOfServiceUrl={termsOfServiceUrl} /></div>
    </div>, parentDocument.body) : null

    return <>
        {detailsPanel}
        <Suspense fallback={<DetailContentLoading label="Loading relationship timeline" className="mt-5 min-h-72" />}>
            <div className="mt-5"><RelationshipGanttContent workspaceSlug={workspaceSlug} relationshipId={relationshipId} planPromise={planPromise} canEdit={canEdit} currentWork={currentWork} userId={userId} onInvoiceRequest={openInvoiceReview} /></div>
        </Suspense>
        {modal}
        {preview}
        {notice ? <WorkspaceSuccessNotice label={notice.label} /> : null}
    </>
}
