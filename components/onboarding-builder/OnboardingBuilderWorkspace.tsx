"use client"

import { useEffect, useMemo, useState, useTransition, type DragEvent, type ReactNode } from "react"
import { createOnboardingModule } from "@/app/[workspaceSlug]/onboarding-builder/actions"
import { publishVisualOnboardingRelease, rotateVisualOnboardingPreview } from "@/app/[workspaceSlug]/onboarding-builder/visual-actions"
import { Avatar } from "@/components/account/Avatar"
import { SortableAuthoringList } from "@/components/onboarding-builder/SortableAuthoringList"
import { VisualBuilderCanvas } from "@/components/onboarding-builder/VisualBuilderCanvas"
import { useCollaborativeOnboardingDocument, type VisualBuilderDocument } from "@/components/onboarding-builder/useCollaborativeOnboardingDocument"
import { RoundPill, SquarePill, Status } from "@/components/ui"
import {
    createButtonBlock,
    createFormBlock,
    createOnboardingField,
    createOnboardingStepV2,
    createVideoBlock,
    type OnboardingBlock,
    type OnboardingBookendDefinitionV2,
    type OnboardingModuleDefinitionV2,
    type OnboardingStepV2,
} from "@/lib/onboarding/block-definition"
import { visualStepTitle } from "@/lib/onboarding/block-validation"
import { normalizedBuilderCursor } from "@/lib/onboarding/builder-presence"
import type { OnboardingBuilderData, OnboardingThemeSlot } from "@/lib/onboarding/configuration-types"
import { ONBOARDING_THEME_SLOTS } from "@/lib/onboarding/configuration-types"
import { ONBOARDING_THEME_SLOT_LABELS, onboardingThemeWarnings } from "@/lib/onboarding/theme"
import { orderOnboardingServices, resolveOrderedModuleSources } from "@/lib/onboarding/session-composition-order"

type DefinitionGroup = {
    key: string
    kind: "module" | "bookend"
    title: string
    definition: OnboardingModuleDefinitionV2 | OnboardingBookendDefinitionV2
}

type Selection = { groupKey: string; stepId: string; blockId: string | null }
type LeftTab = "outline" | "blocks" | "library"

function definitionId(groupKey: string) {
    return groupKey.startsWith("module:") ? groupKey.slice(7) : groupKey
}

function duplicateBlock(block: OnboardingBlock): OnboardingBlock {
    const id = crypto.randomUUID()
    if (block.kind !== "form") return { ...block, id }
    return {
        ...block,
        id,
        fields: block.fields.map((field) => {
            const fieldId = crypto.randomUUID()
            return { ...field, id: fieldId, key: `field-${fieldId.replaceAll("-", "").slice(-12)}` }
        }),
    }
}

function duplicateStep(step: OnboardingStepV2) {
    const id = crypto.randomUUID()
    return {
        ...step,
        id,
        key: `step-${id.replaceAll("-", "").slice(-12)}`,
        blocks: step.blocks.map(duplicateBlock),
    }
}

function IconButton({ label, onClick, disabled, children }: { label: string; onClick: () => void; disabled?: boolean; children: ReactNode }) {
    return <button type="button" aria-label={label} title={label} disabled={disabled} onClick={onClick} className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-neutral-800 bg-neutral-900 text-neutral-400 transition hover:border-neutral-600 hover:text-white disabled:cursor-not-allowed disabled:opacity-30">{children}</button>
}

function RailToggleButton({ side, label, onClick }: { side: "left" | "right"; label: string; onClick: () => void }) {
    return <button data-builder-rail-toggle={side} type="button" aria-label={label} title={label} onClick={onClick} className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-neutral-400 transition hover:text-white">
        <svg viewBox="0 0 24 24" aria-hidden="true" className="h-4 w-4 fill-none stroke-current stroke-2">
            <rect x="4" y="5" width="16" height="14" rx="2" />
            <path d={side === "left" ? "M9 5v14" : "M15 5v14"} />
        </svg>
    </button>
}

function BuilderIcon({ name }: { name: "back" | "desktop" | "mobile" | "preview" | "undo" | "redo" | "publish" }) {
    const paths: Record<typeof name, ReactNode> = {
        back: <path d="m15 18-6-6 6-6" />,
        desktop: <><rect x="3" y="4" width="18" height="12" rx="2" /><path d="M8 20h8M12 16v4" /></>,
        mobile: <><rect x="7" y="2" width="10" height="20" rx="2" /><path d="M11 18h2" /></>,
        preview: <><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" /><circle cx="12" cy="12" r="3" /></>,
        undo: <><path d="M9 7 4 12l5 5" /><path d="M20 17a8 8 0 0 0-13-5" /></>,
        redo: <><path d="m15 7 5 5-5 5" /><path d="M4 17a8 8 0 0 1 13-5" /></>,
        publish: <><path d="M12 3v12" /><path d="m7 8 5-5 5 5" /><path d="M5 21h14" /></>,
    }
    return <svg viewBox="0 0 24 24" aria-hidden="true" className="block h-[17px] w-[17px] shrink-0 fill-none stroke-current stroke-[1.8] [stroke-linecap:round] [stroke-linejoin:round]">{paths[name]}</svg>
}

function composeGroups(document: VisualBuilderDocument, data: OnboardingBuilderData, selectedServiceIds: string[], focusedModuleId: string | null) {
    const modules = new Map(document.modules.map((module) => [module.id, module]))
    if (focusedModuleId) {
        const focusedDefinition = modules.get(focusedModuleId)
        return focusedDefinition ? [{ key: `module:${focusedDefinition.id}`, kind: "module" as const, title: focusedDefinition.name, definition: focusedDefinition }] : []
    }
    const selectedServices = orderOnboardingServices(data.services.filter((service) => selectedServiceIds.includes(service.id) && service.state === "active"))
    const sources = resolveOrderedModuleSources({ services: selectedServices, modules: document.modules, mandatoryModuleIds: data.mandatory.draftModuleIds.length ? data.mandatory.draftModuleIds : data.mandatory.publishedModuleIds })
    return [
        { key: "bookend:welcome", kind: "bookend" as const, title: "Welcome", definition: document.welcome },
        ...sources.flatMap((source) => {
            const sourceDefinition = modules.get(source.moduleId)
            return sourceDefinition ? [{ key: `module:${sourceDefinition.id}`, kind: "module" as const, title: sourceDefinition.name, definition: sourceDefinition }] : []
        }),
        { key: "bookend:completion", kind: "bookend" as const, title: "Completion", definition: document.completion },
    ]
}

function documentDefinition(document: VisualBuilderDocument, groupKey: string) {
    if (groupKey === "bookend:welcome") return document.welcome
    if (groupKey === "bookend:completion") return document.completion
    return document.modules.find((module) => module.id === groupKey.replace("module:", "")) ?? null
}

function replaceDocumentDefinition(document: VisualBuilderDocument, groupKey: string, definition: DefinitionGroup["definition"]) {
    if (groupKey === "bookend:welcome") return { ...document, welcome: definition as OnboardingBookendDefinitionV2 }
    if (groupKey === "bookend:completion") return { ...document, completion: definition as OnboardingBookendDefinitionV2 }
    const moduleId = groupKey.replace("module:", "")
    return { ...document, modules: document.modules.map((module) => module.id === moduleId ? definition as OnboardingModuleDefinitionV2 : module) }
}

function selectedStep(groups: DefinitionGroup[], selection: Selection) {
    const group = groups.find((item) => item.key === selection.groupKey) ?? groups[0]
    const step = group?.definition.steps.find((item) => item.id === selection.stepId) ?? group?.definition.steps[0]
    return { group, step }
}

function railPreference(key: string, fallback: boolean) {
    if (typeof window === "undefined") return fallback
    return window.localStorage.getItem(key) !== "collapsed"
}

export function OnboardingBuilderWorkspace({ workspaceSlug, workspaceName, data, initialBookend }: { workspaceSlug: string; workspaceName: string; data: OnboardingBuilderData; initialBookend?: "welcome" | "completion" | null }) {
    const initialDocument = useMemo<VisualBuilderDocument>(() => ({ modules: data.visualModules, welcome: data.visualWelcome, completion: data.visualCompletion, theme: data.theme, linkedChangeSets: [] }), [data])
    const collaboration = useCollaborativeOnboardingDocument({ workspaceSlug, initial: initialDocument, collaboration: data.collaboration })
    const saveStatus = collaboration.syncState === "synced"
        ? { label: "Saved", tone: "green" as const }
        : collaboration.syncState === "syncing" || collaboration.syncState === "publishing"
            ? { label: "Saving…", tone: "yellow" as const }
            : { label: "Save failed", tone: "red" as const }
    const collaborators = useMemo(() => {
        const known = new Map(data.collaboration.collaborators.map((person) => [person.id, person]))
        if (data.collaboration.currentUser) known.set(data.collaboration.currentUser.id, data.collaboration.currentUser)
        for (const person of collaboration.presence) if (!known.has(person.userId)) known.set(person.userId, { id: person.userId, name: person.name, avatarSrc: person.avatarSrc })
        const active = new Map(collaboration.presence.map((person) => [person.userId, person]))
        return [...known.values()]
            .map((person) => {
                const remotePresence = active.get(person.id)
                const isCurrentUser = person.id === data.collaboration.currentUser?.id
                return {
                    ...person,
                    connected: isCurrentUser ? collaboration.realtimeState === "connected" : Boolean(remotePresence),
                    color: isCurrentUser ? "#FFFFFF" : remotePresence?.color ?? "#525252",
                }
            })
            .sort((left, right) => Number(right.id === data.collaboration.currentUser?.id) - Number(left.id === data.collaboration.currentUser?.id))
    }, [collaboration.presence, collaboration.realtimeState, data.collaboration])
    const activeServices = data.services.filter((service) => service.state === "active")
    const servicePreferenceKey = `betelgeze:onboarding-builder:${workspaceSlug}:services`
    const [selectedServiceIds, setSelectedServiceIds] = useState<string[]>(() => activeServices.slice(0, 1).map((service) => service.id))
    const selectedModuleSummary = data.selectedModule ? data.modules.find((module) => module.id === data.selectedModule?.id) : null
    const [focusedModuleId, setFocusedModuleId] = useState<string | null>(data.selectedModule && !selectedModuleSummary?.usedBy.length && !selectedModuleSummary?.mandatory ? data.selectedModule.id : null)
    const groups = useMemo(() => composeGroups(collaboration.document, data, selectedServiceIds, focusedModuleId), [collaboration.document, data, focusedModuleId, selectedServiceIds])
    const firstGroup = groups[0]
    const initialGroupKey = initialBookend ? `bookend:${initialBookend}` : data.selectedModule ? `module:${data.selectedModule.id}` : firstGroup?.key ?? "bookend:welcome"
    const initialGroup = groups.find((group) => group.key === initialGroupKey) ?? firstGroup
    const [selection, setSelection] = useState<Selection>({ groupKey: initialGroup?.key ?? "", stepId: initialGroup?.definition.steps[0]?.id ?? "", blockId: null })
    const [leftOpen, setLeftOpen] = useState(true)
    const [rightOpen, setRightOpen] = useState(true)
    const [leftTab, setLeftTab] = useState<LeftTab>("outline")
    const [viewport, setViewport] = useState<"desktop" | "mobile">("desktop")
    const [preview, setPreview] = useState(false)
    const [publishOpen, setPublishOpen] = useState(false)
    const [applyToActive, setApplyToActive] = useState(false)
    const [explanation, setExplanation] = useState("We updated parts of your onboarding so we can collect the right information. Please review the affected sections again.")
    const [notice, setNotice] = useState<string | null>(null)
    const [error, setError] = useState<string | null>(null)
    const [pending, startTransition] = useTransition()

    useEffect(() => {
        if (!preview) return
        const exitPreview = (event: KeyboardEvent) => {
            if (event.key === "Escape") setPreview(false)
        }
        window.addEventListener("keydown", exitPreview)
        return () => window.removeEventListener("keydown", exitPreview)
    }, [preview])

    useEffect(() => {
        const timer = window.setTimeout(() => {
            try {
                const stored = JSON.parse(window.localStorage.getItem(servicePreferenceKey) ?? "[]") as string[]
                const valid = stored.filter((id) => activeServices.some((service) => service.id === id))
                if (valid.length) setSelectedServiceIds(valid)
                setLeftOpen(railPreference(`${servicePreferenceKey}:left`, true))
                setRightOpen(railPreference(`${servicePreferenceKey}:right`, true))
            } catch { /* invalid local preference uses defaults */ }
        }, 0)
        return () => window.clearTimeout(timer)
    // Preferences intentionally hydrate once; live catalogue changes arrive on reload.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    useEffect(() => {
        if (!groups.length) return
        if (!groups.some((group) => group.key === selection.groupKey)) {
            const timer = window.setTimeout(() => setSelection({ groupKey: groups[0].key, stepId: groups[0].definition.steps[0]?.id ?? "", blockId: null }), 0)
            return () => window.clearTimeout(timer)
        }
    }, [groups, selection.groupKey])

    const updateActivity = collaboration.updateActivity
    useEffect(() => {
        updateActivity({ selection: selection.groupKey && selection.stepId ? `${selection.groupKey}:${selection.stepId}:${selection.blockId ?? "step"}` : null })
    }, [selection.blockId, selection.groupKey, selection.stepId, updateActivity])

    const resolved = selectedStep(groups, selection)
    const currentGroup = resolved.group
    const currentStep = resolved.step
    const selectedBlock = currentStep?.blocks.find((block) => block.id === selection.blockId) ?? null
    const moduleTitles = groups.filter((group) => group.kind === "module").map((group) => group.title)
    const baselineModules = new Map(data.visualModules.map((module) => [module.id, JSON.stringify(module)]))
    const dirtyModuleIds = collaboration.document.modules.filter((module) => JSON.stringify(module) !== baselineModules.get(module.id)).map((module) => module.id)
    const welcomeDirty = JSON.stringify(collaboration.document.welcome) !== JSON.stringify(data.visualWelcome)
    const completionDirty = JSON.stringify(collaboration.document.completion) !== JSON.stringify(data.visualCompletion)
    const themeDirty = JSON.stringify(collaboration.document.theme) !== JSON.stringify(data.theme)

    function rememberRail(side: "left" | "right", open: boolean) {
        window.localStorage.setItem(`${servicePreferenceKey}:${side}`, open ? "open" : "collapsed")
        if (side === "left") setLeftOpen(open); else setRightOpen(open)
    }

    function updateDefinition(groupKey: string, update: (definition: DefinitionGroup["definition"]) => DefinitionGroup["definition"]) {
        collaboration.updateDocument((document) => {
            if (groupKey === "bookend:welcome") return { ...document, welcome: update(document.welcome) as OnboardingBookendDefinitionV2 }
            if (groupKey === "bookend:completion") return { ...document, completion: update(document.completion) as OnboardingBookendDefinitionV2 }
            const moduleId = groupKey.replace("module:", "")
            return { ...document, modules: document.modules.map((module) => module.id === moduleId ? update(module) as OnboardingModuleDefinitionV2 : module) }
        })
    }

    function updateCurrentStep(step: OnboardingStepV2) {
        if (!currentGroup) return
        updateDefinition(currentGroup.key, (definition) => ({ ...definition, steps: definition.steps.map((item) => item.id === step.id ? step : item) }))
    }

    function updateCurrentRevisionId(revisionId: string) {
        if (!currentGroup) return
        updateDefinition(currentGroup.key, (definition) => ({ ...definition, revisionId }))
    }

    function linkDefinitions(document: VisualBuilderDocument, sourceGroupKey: string, targetGroupKey: string) {
        if (sourceGroupKey === targetGroupKey) return document
        const participants = [definitionId(sourceGroupKey), definitionId(targetGroupKey)].sort()
        const existing = document.linkedChangeSets.find((changeSet) => participants.every((id) => changeSet.definitionIds.includes(id)))
        if (existing) return document
        return { ...document, linkedChangeSets: [...document.linkedChangeSets, { id: crypto.randomUUID(), definitionIds: participants, createdVersion: collaboration.serverVersion }] }
    }

    function moveStep(sourceGroupKey: string, targetGroupKey: string, stepId: string, targetIndex: number, copy: boolean) {
        const moved: { step: OnboardingStepV2 | null } = { step: null }
        collaboration.updateDocument((document) => {
            const source = documentDefinition(document, sourceGroupKey)
            const target = documentDefinition(document, targetGroupKey)
            const sourceStep = source?.steps.find((step) => step.id === stepId)
            if (!source || !target || !sourceStep) return document
            if (targetGroupKey.startsWith("bookend:") && sourceStep.blocks.some((block) => block.kind === "form")) {
                setError("A step containing a Form cannot be moved into a bookend.")
                return document
            }
            if (!copy && source.steps.length === 1) {
                setError(sourceGroupKey.startsWith("bookend:") ? "Each bookend must retain at least one step." : "Each module must retain at least one step.")
                return document
            }
            moved.step = copy ? duplicateStep(sourceStep) : sourceStep
            if (sourceGroupKey === targetGroupKey) {
                const steps = [...source.steps]
                const sourceIndex = steps.findIndex((step) => step.id === stepId)
                if (!copy) steps.splice(sourceIndex, 1)
                const adjustedIndex = !copy && sourceIndex < targetIndex ? targetIndex - 1 : targetIndex
                steps.splice(Math.max(0, Math.min(adjustedIndex, steps.length)), 0, moved.step)
                return replaceDocumentDefinition(document, sourceGroupKey, { ...source, steps })
            }
            let next = copy ? document : replaceDocumentDefinition(document, sourceGroupKey, { ...source, steps: source.steps.filter((step) => step.id !== stepId) })
            const nextTarget = documentDefinition(next, targetGroupKey)
            if (!nextTarget) return document
            const targetSteps = [...nextTarget.steps]
            targetSteps.splice(Math.max(0, Math.min(targetIndex, targetSteps.length)), 0, moved.step)
            next = replaceDocumentDefinition(next, targetGroupKey, { ...nextTarget, steps: targetSteps })
            return linkDefinitions(next, sourceGroupKey, targetGroupKey)
        })
        if (moved.step) setSelection({ groupKey: targetGroupKey, stepId: moved.step.id, blockId: null })
    }

    function moveBlock(sourceGroupKey: string, sourceStepId: string, blockId: string, targetGroupKey: string, targetStepId: string, copy: boolean) {
        const moved: { block: OnboardingBlock | null } = { block: null }
        collaboration.updateDocument((document) => {
            const source = documentDefinition(document, sourceGroupKey)
            const target = documentDefinition(document, targetGroupKey)
            const sourceStep = source?.steps.find((step) => step.id === sourceStepId)
            const targetStep = target?.steps.find((step) => step.id === targetStepId)
            const sourceBlock = sourceStep?.blocks.find((block) => block.id === blockId)
            if (!source || !target || !sourceStep || !targetStep || !sourceBlock || sourceBlock.kind === "header") return document
            if (sourceBlock.kind === "form" && (targetGroupKey.startsWith("bookend:") || targetStep.blocks.some((block) => block.kind === "form" && block.id !== sourceBlock.id))) {
                setError("That target step cannot accept another Form block.")
                return document
            }
            moved.block = copy ? duplicateBlock(sourceBlock) : sourceBlock
            const sourceSteps = source.steps.map((step) => step.id === sourceStepId && !copy ? { ...step, blocks: step.blocks.filter((block) => block.id !== blockId) } : step)
            let next = replaceDocumentDefinition(document, sourceGroupKey, { ...source, steps: sourceSteps })
            const nextTarget = documentDefinition(next, targetGroupKey)
            if (!nextTarget) return document
            const targetSteps = nextTarget.steps.map((step) => step.id === targetStepId
                ? { ...step, blocks: [step.blocks[0], moved.block!, ...step.blocks.slice(1).filter((block) => block.id !== moved.block!.id)] }
                : step)
            next = replaceDocumentDefinition(next, targetGroupKey, { ...nextTarget, steps: targetSteps })
            return linkDefinitions(next, sourceGroupKey, targetGroupKey)
        })
        if (moved.block) setSelection({ groupKey: targetGroupKey, stepId: targetStepId, blockId: moved.block.id })
    }

    function acceptStructureDrop(event: DragEvent<HTMLElement>, targetGroupKey: string, targetStepId: string | null, targetIndex: number) {
        const raw = event.dataTransfer.getData("application/x-betelgeze-builder-item")
        if (!raw) return
        event.preventDefault()
        try {
            const payload = JSON.parse(raw) as { type: "step" | "block" | "library"; groupKey?: string; stepId?: string; blockId?: string; kind?: "form" | "video" | "button"; copy?: boolean }
            if (payload.type === "step" && payload.groupKey && payload.stepId) moveStep(payload.groupKey, targetGroupKey, payload.stepId, targetIndex, Boolean(payload.copy || event.shiftKey))
            else if (payload.type === "block" && payload.groupKey && payload.stepId && payload.blockId && targetStepId) moveBlock(payload.groupKey, payload.stepId, payload.blockId, targetGroupKey, targetStepId, Boolean(payload.copy || event.shiftKey))
            else if (payload.type === "library" && payload.kind && targetStepId) {
                const block = payload.kind === "form" ? createFormBlock() : payload.kind === "video" ? createVideoBlock() : createButtonBlock()
                let inserted = false
                collaboration.updateDocument((document) => {
                    const target = documentDefinition(document, targetGroupKey)
                    const targetStep = target?.steps.find((step) => step.id === targetStepId)
                    if (!target || !targetStep) return document
                    if (payload.kind === "form" && (targetGroupKey.startsWith("bookend:") || targetStep.blocks.some((candidate) => candidate.kind === "form"))) {
                        setError("That target step cannot accept a Form block.")
                        return document
                    }
                    inserted = true
                    const steps = target.steps.map((step) => step.id === targetStepId ? { ...step, blocks: [step.blocks[0], block, ...step.blocks.slice(1)] } : step)
                    return replaceDocumentDefinition(document, targetGroupKey, { ...target, steps })
                })
                if (inserted) setSelection({ groupKey: targetGroupKey, stepId: targetStepId, blockId: block.id })
            }
        } catch { setError("That Builder item could not be moved.") }
    }

    function chooseGroup(group: DefinitionGroup) {
        setSelection({ groupKey: group.key, stepId: group.definition.steps[0]?.id ?? "", blockId: null })
        collaboration.updateActivity({ selection: group.key })
    }

    function addStep() {
        if (!currentGroup) return
        const step = createOnboardingStepV2({ bookend: currentGroup.kind === "bookend", title: currentGroup.kind === "bookend" ? `New ${currentGroup.title.toLowerCase()} step` : "Untitled step", showComposedModuleSummary: currentGroup.key === "bookend:welcome" && currentGroup.definition.steps.length === 0 })
        updateDefinition(currentGroup.key, (definition) => ({ ...definition, steps: [...definition.steps, step] }))
        setSelection({ groupKey: currentGroup.key, stepId: step.id, blockId: step.blocks[0].id })
    }

    function addBlock(kind: "form" | "video" | "button") {
        if (!currentStep || !currentGroup) return
        if (kind === "form" && (currentGroup.kind === "bookend" || currentStep.blocks.some((block) => block.kind === "form"))) return
        const block = kind === "form" ? createFormBlock() : kind === "video" ? createVideoBlock() : createButtonBlock()
        updateCurrentStep({ ...currentStep, blocks: [...currentStep.blocks, block] })
        setSelection({ ...selection, blockId: block.id })
    }

    function updateBlock(block: OnboardingBlock) {
        if (!currentStep) return
        updateCurrentStep({ ...currentStep, blocks: currentStep.blocks.map((item) => item.id === block.id ? block : item) })
    }

    function removeBlock() {
        if (!currentStep || !selectedBlock || selectedBlock.kind === "header") return
        updateCurrentStep({ ...currentStep, blocks: currentStep.blocks.filter((block) => block.id !== selectedBlock.id) })
        setSelection({ ...selection, blockId: null })
    }

    function removeCurrentStep() {
        if (!currentGroup || !currentStep) return
        if (currentGroup.definition.steps.length === 1) {
            setError(currentGroup.kind === "bookend" ? "Each bookend must retain at least one step." : "Each module must retain at least one step.")
            return
        }
        const remaining = currentGroup.definition.steps.filter((step) => step.id !== currentStep.id)
        updateDefinition(currentGroup.key, (definition) => ({ ...definition, steps: remaining }))
        setSelection({ groupKey: currentGroup.key, stepId: remaining[0].id, blockId: null })
    }

    function addThemeSwatch() {
        const id = crypto.randomUUID()
        collaboration.updateDocument((document) => ({
            ...document,
            theme: { ...document.theme, swatches: [...document.theme.swatches, { id, name: "New colour", hex: "#64748B", hidden: false }] },
        }))
    }

    function updateThemeSwatch(id: string, values: { name?: string; hex?: string; hidden?: boolean }) {
        collaboration.updateDocument((document) => ({
            ...document,
            theme: { ...document.theme, swatches: document.theme.swatches.map((swatch) => swatch.id === id ? { ...swatch, ...values } : swatch) },
        }))
    }

    function currentPublishScope() {
        const visibleModuleIds = new Set(groups.filter((group) => group.kind === "module").map((group) => group.key.replace("module:", "")))
        const included = new Set<string>(focusedModuleId ? [focusedModuleId] : [...visibleModuleIds, "bookend:welcome", "bookend:completion"])
        let changed = true
        while (changed) {
            changed = false
            for (const changeSet of collaboration.document.linkedChangeSets) {
                if (changeSet.createdVersion !== undefined && changeSet.createdVersion <= data.collaboration.publishedVersion) continue
                if (!changeSet.definitionIds.some((id) => included.has(id))) continue
                for (const id of changeSet.definitionIds) if (!included.has(id)) { included.add(id); changed = true }
            }
        }
        return {
            modules: collaboration.document.modules.filter((module) => included.has(module.id) && dirtyModuleIds.includes(module.id)),
            bookends: [included.has("bookend:welcome") && welcomeDirty ? collaboration.document.welcome : null, included.has("bookend:completion") && completionDirty ? collaboration.document.completion : null].filter(Boolean) as OnboardingBookendDefinitionV2[],
            theme: !focusedModuleId && themeDirty ? collaboration.document.theme : null,
        }
    }

    const publishScope = currentPublishScope()
    const publishCount = publishScope.modules.length + publishScope.bookends.length + (publishScope.theme ? 1 : 0)
    const builderGridColumns = leftOpen
        ? rightOpen
            ? "md:grid-cols-[18rem_minmax(0,1fr)] xl:grid-cols-[18rem_minmax(0,1fr)_18rem]"
            : "md:grid-cols-[18rem_minmax(0,1fr)] xl:grid-cols-[18rem_minmax(0,1fr)_3rem]"
        : rightOpen
            ? "md:grid-cols-[3rem_minmax(0,1fr)] xl:grid-cols-[3rem_minmax(0,1fr)_18rem]"
            : "md:grid-cols-[3rem_minmax(0,1fr)] xl:grid-cols-[3rem_minmax(0,1fr)_3rem]"

    async function publishChanges() {
        setError(null); setNotice(null)
        const version = await collaboration.flush()
        await collaboration.setReleaseLock(true)
        try {
            const outcome = await publishVisualOnboardingRelease(workspaceSlug, {
                ...publishScope,
                expectedDocumentVersion: version,
                applyToActive,
                explanation,
            })
            if (!outcome.ok) { setError(outcome.error); return }
            setPublishOpen(false)
            setNotice("Onboarding release published.")
            window.setTimeout(() => window.location.reload(), 650)
        } finally {
            await collaboration.setReleaseLock(false)
        }
    }

    async function createPreviewLink() {
        const snapshot = { schemaVersion: 2, workspaceName, serviceIds: selectedServiceIds, modules: groups.filter((group) => group.kind === "module").map((group) => group.definition), welcome: collaboration.document.welcome, completion: collaboration.document.completion, theme: collaboration.document.theme, help: data.help }
        const outcome = await rotateVisualOnboardingPreview(workspaceSlug, snapshot)
        if (!outcome.ok) { setError(outcome.error); return }
        const url = `${window.location.origin}/onboarding/preview/${outcome.data.token}`
        await navigator.clipboard.writeText(url)
        setNotice("Frozen 24-hour preview link copied.")
    }

    if (preview) return <div data-builder-fullscreen-preview className="relative flex h-dvh w-full items-stretch justify-center overflow-hidden bg-black">
        <button type="button" onClick={() => setPreview(false)} className="fixed right-4 top-4 z-[100] rounded-full border border-white/20 bg-black/70 px-4 py-2 text-xs font-semibold text-white shadow-lg backdrop-blur transition hover:bg-black focus:outline-none focus:ring-2 focus:ring-white/70">Exit preview</button>
        {currentGroup && currentStep ? <VisualBuilderCanvas workspaceSlug={workspaceSlug} workspaceName={workspaceName} groupKey={currentGroup.key} target={currentGroup.kind === "module" ? { kind: "module", definition: currentGroup.definition as OnboardingModuleDefinitionV2 } : { kind: "bookend", definition: currentGroup.definition as OnboardingBookendDefinitionV2 }} step={currentStep} steps={currentGroup.definition.steps} moduleTitles={moduleTitles} theme={collaboration.document.theme} help={data.help} selectedBlockId={null} selectBlock={() => undefined} selectStep={(stepId) => setSelection({ ...selection, stepId, blockId: null })} updateStep={() => undefined} updateDraftRevisionId={() => undefined} viewport={viewport} readOnly fullScreen /> : <div className="flex h-full items-center justify-center text-sm text-white/60">Choose or create a module to preview.</div>}
    </div>

    return <div onPointerMove={(event) => collaboration.updateActivity({ cursor: normalizedBuilderCursor(event.clientX, event.clientY, window.innerWidth, window.innerHeight) })} onPointerLeave={() => collaboration.updateActivity({ cursor: null })} className="flex h-dvh min-h-[42rem] flex-col overflow-hidden bg-neutral-950 text-white">
        <header className="flex h-14 shrink-0 items-center gap-2 border-b border-neutral-800 bg-black px-3 sm:px-4">
            <a href={`/${workspaceSlug}/settings#onboarding`} className="inline-flex h-9 items-center gap-2 rounded-lg px-2 text-sm text-neutral-400 hover:bg-neutral-900 hover:text-white"><BuilderIcon name="back" /><span className="hidden sm:inline">Back to Betelgeze</span></a>
            <span className="hidden h-5 w-px bg-neutral-800 sm:block" />
            <div className="min-w-0"><p className="truncate text-sm font-medium">Onboarding Builder</p><p className="hidden text-[11px] text-neutral-600 sm:block">{workspaceName}</p></div>
            <div className="ml-2 hidden min-w-0 flex-1 items-center gap-2 md:flex">
                <label className="text-xs text-neutral-500">Session</label>
                <div className="flex max-w-[28rem] flex-wrap gap-1">{activeServices.map((service) => <button key={service.id} type="button" onClick={() => { const next = selectedServiceIds.includes(service.id) ? selectedServiceIds.filter((id) => id !== service.id) : [...selectedServiceIds, service.id]; setSelectedServiceIds(next); window.localStorage.setItem(servicePreferenceKey, JSON.stringify(next)); setFocusedModuleId(null) }} className={`rounded-md border px-2 py-1 text-[11px] ${selectedServiceIds.includes(service.id) ? "border-neutral-500 bg-neutral-800 text-white" : "border-neutral-800 text-neutral-500 hover:text-neutral-300"}`}>{service.name}</button>)}</div>
            </div>
            <div className="ml-auto flex items-center gap-1.5">
                <div aria-label="Builder collaborators" className="flex items-center -space-x-1.5">{collaborators.map((person) => <span key={person.id} title={`${person.name} — ${person.connected ? "Connected" : "Disconnected"}`} className="flex h-7 w-7 shrink-0 items-center justify-center overflow-hidden rounded-full border-2 bg-neutral-900 transition" style={{ borderColor: person.color }}><span className={`h-full w-full transition ${person.connected ? "" : "grayscale opacity-40"}`}><Avatar src={person.avatarSrc} name={person.name} className="h-full w-full" /></span></span>)}</div>
                <span className="text-[11px] text-neutral-500"><Status label={saveStatus.label} tone={saveStatus.tone} /></span>
                <IconButton label="Undo your last edit" onClick={collaboration.undo} disabled={!collaboration.undoState.canUndo || !collaboration.editable}><BuilderIcon name="undo" /></IconButton>
                <IconButton label="Redo your last edit" onClick={collaboration.redo} disabled={!collaboration.undoState.canRedo || !collaboration.editable}><BuilderIcon name="redo" /></IconButton>
                <div className="hidden items-center rounded-lg border border-neutral-800 p-0.5 sm:flex"><button data-builder-viewport-toggle type="button" aria-label="Desktop preview" onClick={() => setViewport("desktop")} className={`inline-flex h-8 w-8 items-center justify-center rounded-md leading-none ${viewport === "desktop" ? "bg-neutral-800 text-white" : "text-neutral-500"}`}><BuilderIcon name="desktop" /></button><button data-builder-viewport-toggle type="button" aria-label="Mobile preview" onClick={() => setViewport("mobile")} className={`inline-flex h-8 w-8 items-center justify-center rounded-md leading-none ${viewport === "mobile" ? "bg-neutral-800 text-white" : "text-neutral-500"}`}><BuilderIcon name="mobile" /></button></div>
                <button type="button" onClick={() => setPreview((value) => !value)} className="inline-flex h-9 items-center justify-center gap-2 rounded-lg border border-neutral-700 px-3 text-xs font-medium leading-none text-neutral-200"><BuilderIcon name="preview" />{preview ? "Edit" : "Preview"}</button>
                <button type="button" disabled={!publishCount || !collaboration.editable} onClick={() => setPublishOpen(true)} className="inline-flex h-9 items-center justify-center gap-2 rounded-lg bg-white px-3 text-xs font-semibold leading-none text-black disabled:opacity-30"><BuilderIcon name="publish" />Publish{publishCount ? ` ${publishCount}` : ""}</button>
            </div>
        </header>

        {notice || error ? <div className={`shrink-0 border-b px-4 py-2 text-center text-xs ${error ? "border-red-900 bg-red-950 text-red-200" : "border-emerald-900 bg-emerald-950 text-emerald-200"}`}>{error ?? notice}</div> : null}
        {!data.schemaReady ? <div className="border-b border-yellow-800 bg-yellow-950 px-4 py-2 text-center text-xs text-yellow-100">The visual Builder schema must be deployed before edits can be published.</div> : null}

        <div className={`grid min-h-0 flex-1 ${preview ? "grid-cols-1" : builderGridColumns}`}>
            {!preview ? <aside className={`min-h-0 border-r border-neutral-800 bg-neutral-950 ${leftOpen ? "hidden md:flex md:flex-col" : "hidden md:flex md:items-start md:justify-center md:pt-3"}`}>
                {leftOpen ? <><div data-builder-left-rail-header className="flex h-12 items-center gap-1 border-b border-neutral-800 px-2"><RailToggleButton side="left" label="Collapse left rail" onClick={() => rememberRail("left", false)} /><button type="button" onClick={() => setLeftTab("outline")} className={`h-8 rounded-md px-2 text-xs ${leftTab === "outline" ? "bg-neutral-800 text-white" : "text-neutral-500"}`}>Outline</button><button type="button" onClick={() => setLeftTab("blocks")} className={`h-8 rounded-md px-2 text-xs ${leftTab === "blocks" ? "bg-neutral-800 text-white" : "text-neutral-500"}`}>Blocks</button><button type="button" onClick={() => setLeftTab("library")} className={`h-8 rounded-md px-2 text-xs ${leftTab === "library" ? "bg-neutral-800 text-white" : "text-neutral-500"}`}>Library</button></div><div className="min-h-0 flex-1 overflow-y-auto p-2">
                    {leftTab === "outline" ? (
                        <div className="space-y-2">{groups.map((group) => (
                            <section key={group.key} onDragOver={(event) => event.preventDefault()} onDrop={(event) => acceptStructureDrop(event, group.key, group.definition.steps.at(-1)?.id ?? null, group.definition.steps.length)} className="rounded-xl border border-neutral-800 bg-black/40">
                                <button type="button" onClick={() => chooseGroup(group)} className="flex w-full items-center gap-2 px-3 py-2 text-left"><span className="min-w-0 flex-1 truncate text-xs font-semibold text-neutral-300">{group.title}</span>{group.kind === "bookend" ? <RoundPill>Bookend</RoundPill> : null}</button>
                                <div className="border-t border-neutral-900 p-1"><SortableAuthoringList items={group.definition.steps} disabled={!collaboration.editable} onChange={(steps) => updateDefinition(group.key, (definition) => ({ ...definition, steps }))} ariaLabel={`${group.title} steps`} renderItem={(step, index, handle) => (
                                    <div draggable={collaboration.editable} onDragStart={(event) => { event.stopPropagation(); event.dataTransfer.setData("application/x-betelgeze-builder-item", JSON.stringify({ type: "step", groupKey: group.key, stepId: step.id, copy: event.shiftKey })); event.dataTransfer.effectAllowed = event.shiftKey ? "copy" : "move" }} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.stopPropagation(); acceptStructureDrop(event, group.key, step.id, index) }} className={`flex items-center rounded-lg ${selection.stepId === step.id ? "bg-neutral-800" : "hover:bg-neutral-900"}`}>{handle}<button type="button" onClick={() => setSelection({ groupKey: group.key, stepId: step.id, blockId: null })} className="min-w-0 flex-1 truncate py-2 pr-2 text-left text-xs text-neutral-300">{index + 1}. {visualStepTitle(step)}</button></div>
                                )} /></div>
                            </section>
                        ))}</div>
                    ) : leftTab === "blocks" ? <div className="space-y-2"><p className="px-2 text-xs text-neutral-500">Drag blocks onto the canvas or click to append.</p><button type="button" disabled className="flex w-full items-center gap-3 rounded-xl border border-neutral-800 bg-black p-3 text-left opacity-50"><span className="text-lg">H</span><span><b className="block text-sm">Header</b><small className="text-neutral-600">Required at the top</small></span></button>{(["form", "video", "button"] as const).map((kind) => <button key={kind} type="button" draggable={collaboration.editable} disabled={!collaboration.editable || !currentStep || (kind === "form" && (currentGroup?.kind === "bookend" || currentStep.blocks.some((block) => block.kind === "form")))} onDragStart={(event) => { event.dataTransfer.setData("application/x-betelgeze-builder-item", JSON.stringify({ type: "library", kind })); event.dataTransfer.effectAllowed = "copy" }} onClick={() => addBlock(kind)} className="flex w-full cursor-grab items-center gap-3 rounded-xl border border-neutral-800 bg-black p-3 text-left capitalize hover:border-neutral-600 disabled:cursor-not-allowed disabled:opacity-30"><span className="flex h-8 w-8 items-center justify-center rounded-lg bg-neutral-800 text-sm">{kind === "form" ? "▤" : kind === "video" ? "▶" : "↗"}</span><span className="text-sm">{kind}</span></button>)}<button type="button" disabled className="flex w-full items-center gap-3 rounded-xl border border-dashed border-neutral-800 p-3 text-left opacity-40"><span className="flex h-8 w-8 items-center justify-center rounded-lg bg-neutral-900">▦</span><span><b className="block text-sm">Calendar</b><small>Coming later</small></span></button></div> : <div><div className="flex items-center justify-between px-2 pb-2"><p className="text-xs text-neutral-500">All modules</p><button type="button" disabled={pending || !collaboration.editable} onClick={() => startTransition(async () => { const outcome = await createOnboardingModule(workspaceSlug); if (!outcome.ok) setError(outcome.error); else window.location.href = `/${workspaceSlug}/onboarding-builder?module=${outcome.data?.module_id}` })} className="text-xs text-neutral-300 underline underline-offset-4">New module</button></div>{collaboration.document.modules.map((module) => <button key={module.id} type="button" onClick={() => { setFocusedModuleId(module.id); const group = { key: `module:${module.id}`, kind: "module" as const, title: module.name, definition: module }; chooseGroup(group) }} className={`mb-1 flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left ${focusedModuleId === module.id ? "bg-neutral-800" : "hover:bg-neutral-900"}`}><span className="min-w-0 flex-1 truncate text-sm text-neutral-300">{module.name}</span>{module.isTest ? <SquarePill tone="yellow">Test</SquarePill> : null}</button>)}{focusedModuleId ? <button type="button" onClick={() => setFocusedModuleId(null)} className="mt-3 w-full rounded-lg border border-neutral-700 px-3 py-2 text-xs">Return to composed session</button> : null}</div>}
                </div><div className="border-t border-neutral-800 p-2"><button type="button" disabled={!currentGroup || !collaboration.editable} onClick={addStep} className="h-9 w-full rounded-lg border border-neutral-700 text-xs text-neutral-300">Add step</button></div></> : <RailToggleButton side="left" label="Expand left rail" onClick={() => rememberRail("left", true)} />}
            </aside> : null}

            <main onDragOver={(event) => event.preventDefault()} onDrop={(event) => currentGroup && currentStep && acceptStructureDrop(event, currentGroup.key, currentStep.id, currentGroup.definition.steps.indexOf(currentStep))} className="min-h-0 overflow-auto bg-neutral-900/50 p-3 sm:p-5">
                {!preview && currentGroup && currentStep ? <div className="mx-auto mb-3 hidden max-w-[1180px] flex-wrap items-center justify-end gap-2 rounded-xl border border-neutral-800 bg-neutral-950/90 p-2 text-xs text-neutral-400 md:flex">
                    <span className="mr-auto px-1">{selectedBlock && selectedBlock.kind !== "header" ? `Selected ${selectedBlock.kind} block` : `Step: ${visualStepTitle(currentStep)}`}</span>
                    <label className="sr-only" htmlFor="builder-move-target">Move selection to</label>
                    <select id="builder-move-target" defaultValue="" onChange={(event) => { const [targetGroupKey, targetStepId] = event.target.value.split("|"); if (!targetGroupKey || !targetStepId) return; if (selectedBlock && selectedBlock.kind !== "header") moveBlock(currentGroup.key, currentStep.id, selectedBlock.id, targetGroupKey, targetStepId, false); else moveStep(currentGroup.key, targetGroupKey, currentStep.id, documentDefinition(collaboration.document, targetGroupKey)?.steps.length ?? 0, false); event.currentTarget.value = "" }} className="h-8 max-w-56 rounded-lg border border-neutral-700 bg-black px-2 text-xs text-neutral-300">
                        <option value="">Move to…</option>
                        {groups.flatMap((group) => group.definition.steps.map((candidate) => <option key={`${group.key}:${candidate.id}`} value={`${group.key}|${candidate.id}`} disabled={(selectedBlock?.kind === "form" || (!selectedBlock && currentStep.blocks.some((block) => block.kind === "form"))) && group.kind === "bookend"}>{group.title} · {visualStepTitle(candidate)}</option>))}
                    </select>
                    <button type="button" onClick={() => selectedBlock && selectedBlock.kind !== "header" ? moveBlock(currentGroup.key, currentStep.id, selectedBlock.id, currentGroup.key, currentStep.id, true) : moveStep(currentGroup.key, currentGroup.key, currentStep.id, currentGroup.definition.steps.indexOf(currentStep) + 1, true)} className="h-8 rounded-lg border border-neutral-700 px-2 text-neutral-300">Duplicate</button>
                    {!selectedBlock ? <button type="button" onClick={removeCurrentStep} className="h-8 rounded-lg border border-red-950 px-2 text-red-300">Delete step</button> : null}
                </div> : null}
                {currentGroup && currentStep ? <VisualBuilderCanvas workspaceSlug={workspaceSlug} workspaceName={workspaceName} groupKey={currentGroup.key} target={currentGroup.kind === "module" ? { kind: "module", definition: currentGroup.definition as OnboardingModuleDefinitionV2 } : { kind: "bookend", definition: currentGroup.definition as OnboardingBookendDefinitionV2 }} step={currentStep} steps={currentGroup.definition.steps} moduleTitles={moduleTitles} theme={collaboration.document.theme} help={data.help} selectedBlockId={preview ? null : selection.blockId} selectBlock={(blockId) => !preview && setSelection({ ...selection, blockId })} selectStep={(stepId) => setSelection({ ...selection, stepId, blockId: null })} updateStep={preview ? () => undefined : updateCurrentStep} updateDraftRevisionId={updateCurrentRevisionId} viewport={viewport} readOnly={preview} collaboratorSelections={collaboration.presence} /> : <div className="flex h-full items-center justify-center text-sm text-neutral-500">Choose or create a module to start building.</div>}
            </main>

            {!preview ? <aside className={`min-h-0 border-l border-neutral-800 bg-neutral-950 ${rightOpen ? "hidden xl:flex xl:flex-col" : "hidden xl:flex xl:items-start xl:justify-center xl:pt-3"}`}>
                {rightOpen ? <><div className="flex h-12 items-center border-b border-neutral-800 px-3"><div><p className="text-xs font-semibold">Style and advanced</p><p className="text-[10px] text-neutral-600">{selectedBlock ? selectedBlock.kind : "Global style"}</p></div><span className="ml-auto"><RailToggleButton side="right" label="Collapse right rail" onClick={() => rememberRail("right", false)} /></span></div><div className="min-h-0 flex-1 overflow-y-auto p-3">
                    {selectedBlock ? <div className="space-y-4"><div className="grid grid-cols-2 gap-2"><label className="text-xs text-neutral-500">Width<select value={selectedBlock.layout.width} onChange={(event) => updateBlock({ ...selectedBlock, layout: { ...selectedBlock.layout, width: event.target.value as OnboardingBlock["layout"]["width"] } })} className="mt-1 h-9 w-full rounded-lg border border-neutral-700 bg-black px-2 text-xs text-white"><option value="narrow">Narrow</option><option value="standard">Standard</option><option value="wide">Wide</option><option value="full">Full</option></select></label><label className="text-xs text-neutral-500">Alignment<select value={selectedBlock.layout.alignment} onChange={(event) => updateBlock({ ...selectedBlock, layout: { ...selectedBlock.layout, alignment: event.target.value as OnboardingBlock["layout"]["alignment"] } })} className="mt-1 h-9 w-full rounded-lg border border-neutral-700 bg-black px-2 text-xs text-white"><option value="left">Left</option><option value="center">Centre</option></select></label></div><label className="block text-xs text-neutral-500">Spacing before<select value={selectedBlock.layout.spacingBefore} onChange={(event) => updateBlock({ ...selectedBlock, layout: { ...selectedBlock.layout, spacingBefore: event.target.value as OnboardingBlock["layout"]["spacingBefore"] } })} className="mt-1 h-9 w-full rounded-lg border border-neutral-700 bg-black px-2 text-xs text-white"><option value="compact">Compact</option><option value="normal">Normal</option><option value="spacious">Spacious</option></select></label>{selectedBlock.kind === "header" && currentGroup?.key === "bookend:welcome" && currentGroup.definition.steps[0]?.id === currentStep?.id ? <label className="flex items-center gap-2 rounded-lg border border-neutral-800 p-3 text-xs text-neutral-300"><input type="checkbox" checked={Boolean(selectedBlock.showComposedModuleSummary)} onChange={(event) => updateBlock({ ...selectedBlock, showComposedModuleSummary: event.target.checked })} />Show composed module list</label> : null}{selectedBlock.kind === "form" ? <><label className="block text-xs text-neutral-500">Why we ask<textarea value={selectedBlock.whyWeAsk} onChange={(event) => updateBlock({ ...selectedBlock, whyWeAsk: event.target.value })} rows={3} className="mt-1 w-full rounded-lg border border-neutral-700 bg-black p-2 text-sm text-white" /></label><button type="button" onClick={() => updateBlock({ ...selectedBlock, fields: [...selectedBlock.fields, createOnboardingField()] })} className="h-9 w-full rounded-lg border border-neutral-700 text-xs">Add field</button>{selectedBlock.fields.map((field) => <div key={field.id} className="rounded-lg border border-neutral-800 p-2"><select value={field.type} onChange={(event) => updateBlock({ ...selectedBlock, fields: selectedBlock.fields.map((item) => item.id === field.id ? { ...item, type: event.target.value as typeof field.type, multiple: event.target.value === "file" ? item.multiple : false } : item) })} className="h-8 w-full rounded border border-neutral-700 bg-black px-2 text-xs"><option value="text">Short text</option><option value="email">Email</option><option value="tel">Phone</option><option value="url">URL</option><option value="textarea">Long text</option><option value="file">File</option></select><label className="mt-2 flex items-center gap-2 text-xs text-neutral-400"><input type="checkbox" checked={field.required} onChange={(event) => updateBlock({ ...selectedBlock, fields: selectedBlock.fields.map((item) => item.id === field.id ? { ...item, required: event.target.checked } : item) })} />Required</label></div>)}</> : null}{selectedBlock.kind === "button" ? <label className="block text-xs text-neutral-500">Appearance<select value={selectedBlock.appearance} onChange={(event) => updateBlock({ ...selectedBlock, appearance: event.target.value as "primary" | "secondary" })} className="mt-1 h-9 w-full rounded-lg border border-neutral-700 bg-black px-2 text-xs text-white"><option value="primary">Primary</option><option value="secondary">Secondary</option></select></label> : null}{selectedBlock.kind !== "header" ? <button type="button" onClick={removeBlock} className="text-xs text-red-300">Delete block</button> : <p className="text-xs text-neutral-600">The Header is required and always stays first.</p>}</div> : <div className="space-y-4"><p className="text-xs leading-5 text-neutral-500">These six colours are shared with Agency Branding and client portals. Changes remain drafts until Publish.</p><section className="space-y-2 rounded-xl border border-neutral-800 p-2"><div className="flex items-center justify-between gap-2"><h3 className="text-xs font-semibold text-neutral-300">Colour palette</h3><button type="button" onClick={addThemeSwatch} className="text-[11px] text-neutral-300 underline underline-offset-4">Add colour</button></div>{collaboration.document.theme.swatches.map((swatch) => <div key={swatch.id} className={`grid grid-cols-[2rem_minmax(0,1fr)_auto] items-center gap-2 ${swatch.hidden ? "opacity-50" : ""}`}><input type="color" aria-label={`${swatch.name} colour`} value={swatch.hex} onChange={(event) => updateThemeSwatch(swatch.id, { hex: event.target.value.toUpperCase() })} className="h-8 w-8 rounded border border-neutral-700 bg-transparent p-0" /><input value={swatch.name} onChange={(event) => updateThemeSwatch(swatch.id, { name: event.target.value })} aria-label="Colour name" className="h-8 min-w-0 rounded border border-neutral-700 bg-black px-2 text-xs text-white" /><button type="button" onClick={() => updateThemeSwatch(swatch.id, { hidden: !swatch.hidden })} className="text-[10px] text-neutral-400">{swatch.hidden ? "Restore" : "Hide"}</button></div>)}</section>{ONBOARDING_THEME_SLOTS.map((slot: OnboardingThemeSlot) => <label key={slot} className="block text-xs text-neutral-400">{ONBOARDING_THEME_SLOT_LABELS[slot]}<select value={collaboration.document.theme.assignments[slot]} onChange={(event) => collaboration.updateDocument((document) => ({ ...document, theme: { ...document.theme, assignments: { ...document.theme.assignments, [slot]: event.target.value } } }))} className="mt-1 h-9 w-full rounded-lg border border-neutral-700 bg-black px-2 text-xs text-white">{collaboration.document.theme.swatches.filter((swatch) => !swatch.hidden || swatch.id === collaboration.document.theme.assignments[slot]).map((swatch) => <option key={swatch.id} value={swatch.id}>{swatch.name}</option>)}</select></label>)}{onboardingThemeWarnings(collaboration.document.theme).map((warning) => <p key={warning} className="rounded-lg border border-yellow-900 bg-yellow-950 p-2 text-[11px] text-yellow-200">{warning}</p>)}</div>}
                    {selectedBlock ? <label className="mt-4 block text-xs text-neutral-500">Spacing after<select value={selectedBlock.layout.spacingAfter} onChange={(event) => updateBlock({ ...selectedBlock, layout: { ...selectedBlock.layout, spacingAfter: event.target.value as OnboardingBlock["layout"]["spacingAfter"] } })} className="mt-1 h-9 w-full rounded-lg border border-neutral-700 bg-black px-2 text-xs text-white"><option value="compact">Compact</option><option value="normal">Normal</option><option value="spacious">Spacious</option></select></label> : null}
                </div></> : <RailToggleButton side="right" label="Expand right rail" onClick={() => rememberRail("right", true)} />}
            </aside> : null}
        </div>
        {!preview ? collaboration.presence.filter((person) => person.cursor).map((person) => <div key={`cursor:${person.clientId}`} className="pointer-events-none fixed z-[80] flex items-center gap-1" style={{ left: `${person.cursor!.xRatio * 100}vw`, top: `${person.cursor!.yRatio * 100}vh`, color: person.color }}><span className="h-3 w-3 -translate-x-0.5 -translate-y-0.5 rotate-45 border-l-2 border-t-2" /><span className="rounded px-1 py-0.5 text-[10px] font-semibold text-black" style={{ backgroundColor: person.color }}>{person.name}</span></div>) : null}

        {publishOpen ? <div role="dialog" aria-modal="true" aria-labelledby="publish-title" className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"><section className="max-h-[90dvh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-neutral-700 bg-neutral-950 p-5 shadow-2xl"><div className="flex items-start justify-between gap-4"><div><h2 id="publish-title" className="text-lg font-semibold">Review onboarding release</h2><p className="mt-1 text-sm text-neutral-500">One transaction publishes every item below or rolls everything back.</p></div><button type="button" onClick={() => setPublishOpen(false)} className="text-neutral-500">✕</button></div><div className="mt-5 space-y-2">{publishScope.modules.map((module) => <div key={module.id} className="rounded-xl border border-neutral-800 bg-black p-3"><p className="text-sm font-medium">{module.name}</p><p className="mt-1 text-xs text-neutral-600">{module.steps.length} steps · visual module draft</p></div>)}{publishScope.bookends.map((bookend) => <div key={bookend.kind} className="rounded-xl border border-neutral-800 bg-black p-3"><p className="text-sm font-medium capitalize">{bookend.kind}</p><p className="mt-1 text-xs text-neutral-600">{bookend.steps.length} steps · {bookend.kind === "welcome" ? "future sessions only" : "future and active-incomplete sessions"}</p></div>)}{publishScope.theme ? <div className="rounded-xl border border-yellow-800 bg-yellow-950/40 p-3"><p className="text-sm font-medium text-yellow-100">Global Style</p><p className="mt-1 text-xs leading-5 text-yellow-200/70">Publishing colours immediately updates active and completed onboarding sessions and later client portal surfaces.</p></div> : null}</div><fieldset className="mt-5 space-y-2"><legend className="text-sm font-medium">Client scope</legend><label className="flex gap-3 rounded-xl border border-neutral-800 p-3 text-sm"><input type="radio" checked={!applyToActive} onChange={() => setApplyToActive(false)} />Future sessions only</label><label className="flex gap-3 rounded-xl border border-neutral-800 p-3 text-sm"><input type="radio" checked={applyToActive} onChange={() => setApplyToActive(true)} />Future + all affected active sessions</label></fieldset>{applyToActive ? <label className="mt-4 block text-sm text-neutral-400">Client explanation<textarea value={explanation} onChange={(event) => setExplanation(event.target.value)} rows={3} className="mt-2 w-full rounded-xl border border-neutral-700 bg-black p-3 text-white" /></label> : null}{error ? <p className="mt-3 text-sm text-red-300">{error}</p> : null}<div className="mt-5 flex flex-wrap justify-between gap-2"><button type="button" onClick={() => void createPreviewLink()} className="h-10 rounded-lg border border-neutral-700 px-3 text-sm">Copy frozen preview link</button><div className="flex gap-2"><button type="button" onClick={() => setPublishOpen(false)} className="h-10 rounded-lg border border-neutral-700 px-4 text-sm">Cancel</button><button type="button" disabled={pending || !publishCount} onClick={() => startTransition(publishChanges)} className="h-10 rounded-lg bg-white px-4 text-sm font-semibold text-black disabled:opacity-30">{pending ? "Publishing…" : "Publish release"}</button></div></div></section></div> : null}
    </div>
}
