"use client"

import { Fragment, useEffect, useMemo, useState, useTransition, type DragEvent, type ReactNode } from "react"
import { createOnboardingModule, removeOnboardingModule } from "@/app/[workspaceSlug]/onboarding-builder/actions"
import { saveOnboardingHelpSettings } from "@/app/[workspaceSlug]/settings/onboarding-actions"
import { prepareVisualBuilderVideoUpload, publishVisualOnboardingRelease, rotateVisualOnboardingPreview } from "@/app/[workspaceSlug]/onboarding-builder/visual-actions"
import { Avatar } from "@/components/account/Avatar"
import { VisualBuilderCanvas } from "@/components/onboarding-builder/VisualBuilderCanvas"
import { useCollaborativeOnboardingDocument, type VisualBuilderDocument } from "@/components/onboarding-builder/useCollaborativeOnboardingDocument"
import { RoundPill, SquarePill, Status } from "@/components/ui"
import {
    createButtonBlock,
    createChecklistBlock,
    createEstimateBlock,
    createFormBlock,
    createOnboardingField,
    createOnboardingStepV2,
    createVideoBlock,
    type OnboardingBlock,
    type OnboardingBookendDefinitionV2,
    type OnboardingModuleDefinitionV2,
    type OnboardingStepV2,
    type VideoBlock,
} from "@/lib/onboarding/block-definition"
import { visualStepTitle } from "@/lib/onboarding/block-validation"
import { normalizedBuilderCursor } from "@/lib/onboarding/builder-presence"
import type { OnboardingBuilderData, OnboardingHelpSettings, OnboardingThemeSlot } from "@/lib/onboarding/configuration-types"
import { ONBOARDING_THEME_SLOTS } from "@/lib/onboarding/configuration-types"
import { ONBOARDING_THEME_SLOT_LABELS, onboardingThemeWarnings } from "@/lib/onboarding/theme"

type DefinitionGroup =
    | { key: string; kind: "module"; title: string; definition: OnboardingModuleDefinitionV2 }
    | { key: string; kind: "bookend"; title: string; definition: OnboardingBookendDefinitionV2 }

type Selection = { groupKey: string; stepId: string; blockId: string | null; fieldId?: string | null }
type LeftTab = "outline" | "blocks" | "modules"
type RightTab = "inspect" | "styles"
type OnboardingField = Extract<OnboardingBlock, { kind: "form" }>["fields"][number]
const HELP_BLOCK_ID = "builder:client-help"

function duplicateModifier(event: { metaKey: boolean; ctrlKey: boolean }) {
    return event.metaKey || event.ctrlKey
}

function definitionId(groupKey: string) {
    return groupKey.startsWith("module:") ? groupKey.slice(7) : groupKey
}

function blockName(block: OnboardingBlock) {
    return block.name?.trim() || (block.kind === "header" ? "Header block" : block.kind === "estimate" ? "Estimated time" : block.kind === "checklist" ? "Checklist" : block.kind === "form" ? "Form" : block.kind === "video" ? "Video" : "Button")
}

function nextDuplicateName(sourceName: string, siblingNames: string[]) {
    const base = sourceName.replace(/ \(\d+\)$/, "")
    let highest = 0
    for (const siblingName of siblingNames) {
        if (siblingName === base) continue
        const match = siblingName.match(new RegExp(`^${base.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} \\(\\d+\\)$`))
        if (match) highest = Math.max(highest, Number(match[1]))
    }
    return `${base} (${highest + 1})`
}

function duplicateBlock(block: OnboardingBlock, name = block.name): OnboardingBlock {
    const id = crypto.randomUUID()
    if (block.kind !== "form") return { ...block, id, name }
    return {
        ...block,
        id,
        name,
        fields: block.fields.map((field) => {
            const fieldId = crypto.randomUUID()
            return { ...field, id: fieldId, key: `field-${fieldId.replaceAll("-", "").slice(-12)}` }
        }),
    }
}

function duplicateField(field: ReturnType<typeof createOnboardingField>) {
    const id = crypto.randomUUID()
    return { ...field, id, key: `field-${id.replaceAll("-", "").slice(-12)}` }
}

function duplicateStep(step: OnboardingStepV2, title: string) {
    const id = crypto.randomUUID()
    return {
        ...step,
        id,
        key: `step-${id.replaceAll("-", "").slice(-12)}`,
        blocks: step.blocks.map((block) => block.kind === "header" ? { ...duplicateBlock(block), title } : duplicateBlock(block)),
    }
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

function BuilderNavigationIcon({ name }: { name: "back" | "forward" | "reload" }) {
    if (name === "reload") return <svg viewBox="0 0 24 24" aria-hidden="true" className="h-4 w-4 fill-none stroke-current stroke-2"><path d="M20 11a8 8 0 0 0-14.8-3" /><path d="M4 13a8 8 0 0 0 14.8 3" /><path d="M5 4v5h5" /><path d="M19 20v-5h-5" /></svg>
    return <svg viewBox="0 0 24 24" aria-hidden="true" className="h-4 w-4 fill-none stroke-current stroke-2"><path d={name === "back" ? "m15 6-6 6 6 6" : "m9 6 6 6-6 6"} /></svg>
}

function BuilderNavigationButton({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) {
    return <button data-icon-button type="button" aria-label={label} title={label} onClick={onClick} className="inline-flex h-8 w-8 shrink-0 items-center justify-center text-neutral-500 transition hover:text-white">{children}</button>
}

function EyeIcon({ hidden = false }: { hidden?: boolean }) {
    return <svg viewBox="0 0 24 24" aria-hidden="true" className="h-4 w-4 fill-none stroke-current stroke-2 [stroke-linecap:round] [stroke-linejoin:round]"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" /><circle cx="12" cy="12" r="3" />{hidden ? <path d="m4 4 16 16" /> : null}</svg>
}

function TrashIcon() {
    return <svg viewBox="0 0 24 24" aria-hidden="true" className="h-4 w-4 fill-none stroke-current stroke-2 [stroke-linecap:round] [stroke-linejoin:round]"><path d="M4 7h16M9 7V4h6v3m3 0-1 13H7L6 7m4 4v5m4-5v5" /></svg>
}

type OutlineDropTarget = {
    groupKey: string
    stepId: string | null
    moduleIndex?: number
    stepIndex?: number
    blockIndex?: number
    formBlockId?: string
    fieldIndex?: number
}

function ChevronIcon({ collapsed }: { collapsed: boolean }) {
    return <svg viewBox="0 0 20 20" aria-hidden="true" className={`h-3.5 w-3.5 fill-none stroke-current stroke-2 transition-transform ${collapsed ? "-rotate-90" : ""}`}><path d="m5 7 5 5 5-5" /></svg>
}

function OutlineItemIcon({ kind }: { kind: "bookend" | "module" | "step" | "header" | "estimate" | "checklist" | "form" | "video" | "button" | "field" | "help" }) {
    const tone = {
        bookend: "bg-indigo-500/15 text-indigo-300",
        module: "bg-blue-500/15 text-blue-300",
        step: "bg-teal-500/15 text-teal-300",
        header: "bg-sky-500/15 text-sky-300",
        estimate: "bg-lime-500/15 text-lime-300",
        checklist: "bg-emerald-500/15 text-emerald-300",
        form: "bg-cyan-500/15 text-cyan-300",
        video: "bg-violet-500/15 text-violet-300",
        button: "bg-amber-500/15 text-amber-300",
        field: "bg-emerald-500/15 text-emerald-300",
        help: "bg-indigo-500/15 text-indigo-300",
    }[kind]
    const glyph = {
        bookend: <path d="M5 3v14M5 4h9l-2 3 2 3H5" />,
        module: <><rect x="3" y="4" width="14" height="4" rx="1" /><rect x="3" y="12" width="14" height="4" rx="1" /></>,
        step: <><rect x="4" y="3" width="12" height="14" rx="2" /><path d="M7 7h6M7 10h6M7 13h4" /></>,
        header: <path d="M5 5h10M10 5v10M7 15h6" />,
        estimate: <><circle cx="10" cy="10" r="6" /><path d="M10 6v4l3 2" /></>,
        checklist: <><path d="m3 5 1.5 1.5L7 4M9 5h8M3 10l1.5 1.5L7 9M9 10h8M3 15l1.5 1.5L7 14M9 15h8" /></>,
        form: <><path d="M7 5h9M7 10h9M7 15h9" /><circle cx="4" cy="5" r=".6" /><circle cx="4" cy="10" r=".6" /><circle cx="4" cy="15" r=".6" /></>,
        video: <><rect x="3" y="4" width="14" height="12" rx="2" /><path d="m8 8 5 2-5 2Z" /></>,
        button: <><rect x="3" y="6" width="14" height="8" rx="2" /><path d="m9 9 2 1-2 1" /></>,
        field: <><rect x="3" y="6" width="14" height="8" rx="2" /><path d="M6 10h5" /></>,
        help: <><circle cx="10" cy="10" r="7" /><path d="M8 8a2 2 0 1 1 3 1.7c-.8.4-1 1-1 1.8M10 14h.01" /></>,
    }[kind]
    return <span className={`inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-md ${tone}`}><svg viewBox="0 0 20 20" aria-hidden="true" className="h-3.5 w-3.5 fill-none stroke-current stroke-[1.6] [stroke-linecap:round] [stroke-linejoin:round]">{glyph}</svg></span>
}

function OutlineTree({ groups, visibleModuleIds, selection, editable, onSelectStep, onSelectBlock, onSelectField, onSelectHelp, onToggleModule, onDeleteSelection, onDrop }: {
    groups: DefinitionGroup[]
    visibleModuleIds: Set<string>
    selection: Selection
    editable: boolean
    onSelectStep: (groupKey: string, stepId: string) => void
    onSelectBlock: (groupKey: string, stepId: string, blockId: string) => void
    onSelectField: (groupKey: string, stepId: string, blockId: string, fieldId: string) => void
    onSelectHelp: () => void
    onToggleModule: (moduleId: string) => void
    onDeleteSelection: () => void
    onDrop: (event: DragEvent<HTMLElement>, target: OutlineDropTarget) => void
}) {
    const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(() => new Set())
    const [collapsedSteps, setCollapsedSteps] = useState<Set<string>>(() => new Set(groups.flatMap((group) => group.definition.steps.map((step) => `${group.key}:${step.id}`))))
    const [dragging, setDragging] = useState<{ key: string; copy: boolean } | null>(null)

    function toggleCollapsed(setter: typeof setCollapsedGroups, key: string) {
        setter((current) => {
            const next = new Set(current)
            if (next.has(key)) next.delete(key); else next.add(key)
            return next
        })
    }

    function startDrag(event: DragEvent<HTMLElement>, payload: Record<string, unknown>, key: string, label: string) {
        event.stopPropagation()
        const copy = duplicateModifier(event)
        event.dataTransfer.setData("application/x-betelgeze-builder-item", JSON.stringify({ ...payload, copy }))
        event.dataTransfer.effectAllowed = copy ? "copy" : "move"
        const chip = document.createElement("div")
        chip.textContent = label
        chip.dataset.builderDragLabel = "true"
        Object.assign(chip.style, { position: "fixed", left: "-10000px", top: "-10000px", padding: "7px 10px", borderRadius: "8px", background: "#262626", color: "white", font: "12px system-ui", boxShadow: "0 8px 24px rgba(0,0,0,.35)" })
        document.body.appendChild(chip)
        event.dataTransfer.setDragImage(chip, 12, 14)
        window.setTimeout(() => chip.remove(), 0)
        setDragging({ key, copy })
    }

    function selectedRow(active: boolean) {
        return active ? "bg-neutral-800 text-white" : "text-neutral-400 hover:bg-neutral-900 hover:text-neutral-200"
    }

    return <div data-builder-outline-tree className="space-y-1">
        {groups.map((group, groupIndex) => {
            const moduleId = group.kind === "module" ? group.definition.id : null
            const shown = moduleId ? visibleModuleIds.has(moduleId) : true
            const groupCollapsed = collapsedGroups.has(group.key)
            return <Fragment key={group.key}>
                <div className="h-2" onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.stopPropagation(); onDrop(event, { groupKey: group.key, stepId: null, moduleIndex: groupIndex }) }} />
                <section className="overflow-hidden rounded-lg border border-neutral-800/80 bg-black/20">
                <div title="Drag to reorder module" draggable={editable} onDragStart={(event) => startDrag(event, { type: "module", moduleId: group.definition.id }, group.key, group.title)} onDragEnd={() => setDragging(null)} className={`flex h-9 cursor-grab items-center gap-1 px-1.5 ${dragging?.key === group.key ? "opacity-40" : ""}`}>
                    <button type="button" aria-label={`${groupCollapsed ? "Expand" : "Collapse"} ${group.title}`} aria-expanded={!groupCollapsed} onClick={() => toggleCollapsed(setCollapsedGroups, group.key)} className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-neutral-500 hover:bg-neutral-800 hover:text-white"><ChevronIcon collapsed={groupCollapsed} /></button>
                    <span className={`transition ${shown ? "" : "opacity-40 grayscale"}`}><OutlineItemIcon kind={group.kind === "module" ? "module" : "bookend"} /></span>
                    <span className={`min-w-0 flex-1 truncate px-1 text-xs font-bold transition ${shown ? "text-neutral-200" : "text-neutral-600"}`}>{group.title}</span>
                    <span className={`shrink-0 transition ${shown ? "" : "opacity-40 grayscale"}`}>{group.kind === "bookend" ? <RoundPill>Bookend</RoundPill> : group.definition.isTest ? <SquarePill tone="yellow">Test</SquarePill> : null}</span>
                    {moduleId ? <button type="button" aria-label={`${shown ? "Hide" : "Show"} ${group.title} in roadmap`} aria-pressed={shown} onClick={() => onToggleModule(moduleId)} className={`inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md transition hover:bg-neutral-800 hover:text-white ${shown ? "text-neutral-400" : "text-neutral-600"}`}><EyeIcon hidden={!shown} /></button> : <span className="h-7 w-7 shrink-0" />}
                </div>
                {!groupCollapsed ? <div className={`px-1 pb-1 transition ${shown ? "" : "opacity-40 grayscale"}`}>
                    {group.definition.steps.map((step, stepIndex) => {
                        const stepSelected = selection.groupKey === group.key && selection.stepId === step.id && !selection.blockId
                        const stepKey = `${group.key}:${step.id}`
                        const stepCollapsed = collapsedSteps.has(stepKey)
                        return <div key={step.id} className="ml-4" onDragOver={(event) => event.preventDefault()} onDrop={(event) => onDrop(event, { groupKey: group.key, stepId: step.id, stepIndex })}>
                            <div title={shown ? "Drag to move; hold Command on Mac or Control on Windows while dragging to duplicate" : undefined} className={`group/row flex min-h-8 items-center gap-1 rounded-md text-xs ${dragging?.key === stepKey && !dragging.copy ? "opacity-0" : ""} ${selectedRow(stepSelected)}`} draggable={editable && shown} onDragStart={(event) => startDrag(event, { type: "step", groupKey: group.key, stepId: step.id }, stepKey, visualStepTitle(step))} onDragEnd={() => setDragging(null)}>
                                <button type="button" aria-label={`${stepCollapsed ? "Expand" : "Collapse"} ${visualStepTitle(step)}`} aria-expanded={!stepCollapsed} onClick={(event) => { event.stopPropagation(); toggleCollapsed(setCollapsedSteps, stepKey) }} className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-neutral-500 hover:bg-neutral-800 hover:text-white"><ChevronIcon collapsed={stepCollapsed} /></button>
                                <OutlineItemIcon kind="step" />
                                <button type="button" aria-disabled={!shown} onClick={() => { if (shown) onSelectStep(group.key, step.id) }} className="min-w-0 flex-1 truncate py-2 pr-2 text-left"><span className="mr-1 text-neutral-600">{stepIndex + 1}.</span>{visualStepTitle(step)}</button>
                                {stepSelected && shown ? <button type="button" aria-label={`Delete ${visualStepTitle(step)}`} disabled={!editable} onClick={(event) => { event.stopPropagation(); onDeleteSelection() }} className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-neutral-500 transition hover:bg-neutral-700 hover:text-white disabled:opacity-30"><TrashIcon /></button> : <span className="h-7 w-7 shrink-0" />}
                            </div>
                            {!stepCollapsed ? <div className="ml-5">
                                {step.blocks.map((block, blockIndex) => {
                                    const blockSelected = selection.groupKey === group.key && selection.stepId === step.id && selection.blockId === block.id && !selection.fieldId
                                    const blockLabel = blockName(block)
                                    const blockDragKey = `${stepKey}:${block.id}`
                                    return <div key={block.id} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.stopPropagation(); onDrop(event, { groupKey: group.key, stepId: step.id, blockIndex }) }}>
                                        <div title={shown && block.kind !== "header" ? "Drag to move; hold Command on Mac or Control on Windows while dragging to duplicate" : undefined} className={`group/row flex min-h-8 items-center gap-1 rounded-md text-xs ${dragging?.key === blockDragKey && !dragging.copy ? "opacity-0" : ""} ${selectedRow(blockSelected)}`} draggable={editable && shown && block.kind !== "header"} onDragStart={(event) => startDrag(event, { type: "block", groupKey: group.key, stepId: step.id, blockId: block.id }, blockDragKey, blockLabel)} onDragEnd={() => setDragging(null)}>
                                            <span className="h-7 w-7 shrink-0" />
                                            <OutlineItemIcon kind={block.kind} />
                                            <button type="button" aria-disabled={!shown} onClick={() => { if (shown) onSelectBlock(group.key, step.id, block.id) }} className="min-w-0 flex-1 truncate py-2 pr-2 text-left capitalize">{blockLabel}</button>
                                            {blockSelected && shown && block.kind !== "header" && block.kind !== "estimate" ? <button type="button" aria-label={`Delete ${blockLabel}`} disabled={!editable} onClick={(event) => { event.stopPropagation(); onDeleteSelection() }} className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-neutral-500 transition hover:bg-neutral-700 hover:text-white disabled:opacity-30"><TrashIcon /></button> : <span className="h-7 w-7 shrink-0" />}
                                        </div>
                                        {block.kind === "form" ? <div className="ml-5">
                                            {block.fields.map((field, fieldIndex) => {
                                                const fieldSelected = selection.groupKey === group.key && selection.stepId === step.id && selection.blockId === block.id && selection.fieldId === field.id
                                                const fieldDragKey = `${blockDragKey}:${field.id}`
                                                return <div key={field.id} title={shown ? "Drag to reorder within this form; hold Command on Mac or Control on Windows while dragging to duplicate" : undefined} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.stopPropagation(); onDrop(event, { groupKey: group.key, stepId: step.id, formBlockId: block.id, fieldIndex }) }} className={`group/row flex min-h-8 items-center gap-1 rounded-md text-xs ${dragging?.key === fieldDragKey && !dragging.copy ? "opacity-0" : ""} ${selectedRow(fieldSelected)}`} draggable={editable && shown} onDragStart={(event) => startDrag(event, { type: "field", groupKey: group.key, stepId: step.id, formBlockId: block.id, fieldId: field.id }, fieldDragKey, field.label || `Field ${fieldIndex + 1}`)} onDragEnd={() => setDragging(null)}>
                                                    <span className="h-7 w-7 shrink-0" />
                                                    <OutlineItemIcon kind="field" />
                                                    <button type="button" aria-disabled={!shown} onClick={() => { if (shown) onSelectField(group.key, step.id, block.id, field.id) }} className="min-w-0 flex-1 truncate py-2 pr-2 text-left">{field.label || `Field ${fieldIndex + 1}`}</button>
                                                    {fieldSelected && shown ? <button type="button" aria-label={`Delete ${field.label || "field"}`} disabled={!editable} onClick={(event) => { event.stopPropagation(); onDeleteSelection() }} className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-neutral-500 transition hover:bg-neutral-700 hover:text-white disabled:opacity-30"><TrashIcon /></button> : <span className="h-7 w-7 shrink-0" />}
                                                </div>
                                            })}
                                        </div> : null}
                                    </div>
                                })}
                            </div> : null}
                        </div>
                    })}
                </div> : null}
                </section>
            </Fragment>
        })}
        {groups.length ? <div className="h-2" onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.stopPropagation(); onDrop(event, { groupKey: groups.at(-1)!.key, stepId: null, moduleIndex: groups.length }) }} /> : null}
        <section className={`overflow-hidden rounded-lg border border-neutral-800/80 bg-black/20 ${selection.blockId === HELP_BLOCK_ID ? "bg-neutral-800" : ""}`}>
            <button type="button" onClick={onSelectHelp} className="flex h-9 w-full items-center gap-2 px-2 text-left text-xs text-neutral-300"><span className="h-7 w-7 shrink-0" /><OutlineItemIcon kind="help" /><span className="min-w-0 flex-1 truncate font-semibold">Client help</span><RoundPill>Fixed</RoundPill></button>
        </section>
    </div>
}

const inspectorInputClass = "mt-1 h-9 w-full rounded-lg border border-neutral-700 bg-black px-2 text-xs text-white"
const inspectorTextareaClass = "mt-1 w-full rounded-lg border border-neutral-700 bg-black p-2 text-sm text-white"

function InspectorPanel({ currentGroup, step, block, field, help, helpSelected, helpDirty, helpPending, editable, updateStep, updateBlock, updateField, updateHelp, saveHelp, addField, uploadVideo, deleteSelection }: {
    currentGroup: DefinitionGroup | undefined
    step: OnboardingStepV2 | undefined
    block: OnboardingBlock | null
    field: OnboardingField | null
    help: OnboardingHelpSettings
    helpSelected: boolean
    helpDirty: boolean
    helpPending: boolean
    editable: boolean
    updateStep: (step: OnboardingStepV2) => void
    updateBlock: (block: OnboardingBlock) => void
    updateField: (values: Partial<OnboardingField>) => void
    updateHelp: (values: Partial<OnboardingHelpSettings>) => void
    saveHelp: () => void
    addField: () => void
    uploadVideo: (file: File) => void
    deleteSelection: () => void
}) {
    if (helpSelected) return <div data-builder-help-inspector className="space-y-4">
        <label className="block text-xs text-neutral-500">Help text<textarea value={help.text} disabled={!editable} onChange={(event) => updateHelp({ text: event.target.value })} rows={5} maxLength={2_000} className={inspectorTextareaClass} /></label>
        <label className="block text-xs text-neutral-500">Communication method<select value={help.whatsappEnabled ? "whatsapp" : "none"} disabled={!editable} onChange={(event) => updateHelp({ whatsappEnabled: event.target.value === "whatsapp" })} className={inspectorInputClass}><option value="none">No contact action</option><option value="whatsapp" disabled={!help.whatsappVerified}>WhatsApp{help.whatsappVerified && help.whatsappNumber ? ` · ${help.whatsappNumber}` : " · unavailable"}</option></select></label>
        <p className="text-xs leading-5 text-neutral-600">Additional methods will appear here when their Communications connections are available. Client help is fixed and cannot be moved or removed.</p>
        <button type="button" disabled={!editable || !helpDirty || helpPending} onClick={saveHelp} className="h-9 w-full rounded-lg bg-white text-xs font-semibold text-black disabled:opacity-30">{helpPending ? "Saving…" : "Save live help"}</button>
    </div>
    if (!step || !currentGroup) return <p className="text-xs leading-5 text-neutral-500">Select a step, element, or field to inspect it.</p>
    if (field) return <div data-builder-field-inspector className="space-y-4">
        <label className="block text-xs text-neutral-500">Label<input value={field.label} disabled={!editable} onChange={(event) => updateField({ label: event.target.value })} className={inspectorInputClass} /></label>
        <label className="block text-xs text-neutral-500">Help text<textarea value={field.helpText} disabled={!editable} onChange={(event) => updateField({ helpText: event.target.value })} rows={3} className={inspectorTextareaClass} /></label>
        <label className="block text-xs text-neutral-500">Placeholder<input value={field.placeholder} disabled={!editable} onChange={(event) => updateField({ placeholder: event.target.value })} className={inspectorInputClass} /></label>
        <label className="block text-xs text-neutral-500">Field type<select value={field.type} disabled={!editable} onChange={(event) => updateField({ type: event.target.value as OnboardingField["type"], multiple: event.target.value === "file" ? field.multiple : false })} className={inspectorInputClass}><option value="text">Short text</option><option value="email">Email</option><option value="tel">Phone</option><option value="url">URL</option><option value="textarea">Long text</option><option value="file">File</option></select></label>
        <label className="flex items-center gap-2 rounded-lg border border-neutral-800 p-3 text-xs text-neutral-300"><input type="checkbox" checked={field.required} disabled={!editable} onChange={(event) => updateField({ required: event.target.checked })} />Required</label>
        {field.type === "file" ? <><label className="block text-xs text-neutral-500">Accepted files<select value={field.accept} disabled={!editable} onChange={(event) => updateField({ accept: event.target.value as OnboardingField["accept"] })} className={inspectorInputClass}><option value="any">Any file</option><option value="image">Images</option><option value="video">Videos</option><option value="document">Documents</option></select></label><label className="flex items-center gap-2 rounded-lg border border-neutral-800 p-3 text-xs text-neutral-300"><input type="checkbox" checked={field.multiple} disabled={!editable} onChange={(event) => updateField({ multiple: event.target.checked })} />Allow multiple files</label></> : null}
        <button type="button" disabled={!editable} onClick={deleteSelection} className="text-xs text-red-300 disabled:opacity-30">Delete field</button>
    </div>
    if (!block) return <div data-builder-step-inspector className="space-y-4">
        <label className="block text-xs text-neutral-500">Back button label<input value={step.navigation.backLabel} disabled={!editable} onChange={(event) => updateStep({ ...step, navigation: { ...step.navigation, backLabel: event.target.value } })} className={inspectorInputClass} /></label>
        <label className="block text-xs text-neutral-500">Continue button label<input value={step.navigation.continueLabel} disabled={!editable} onChange={(event) => updateStep({ ...step, navigation: { ...step.navigation, continueLabel: event.target.value } })} className={inspectorInputClass} /></label>
        <button type="button" disabled={!editable} onClick={deleteSelection} className="text-xs text-red-300 disabled:opacity-30">Delete step</button>
    </div>
    if (block.kind === "header") return <div className="space-y-4">
        <label className="block text-xs text-neutral-500">Heading<input value={block.title} disabled={!editable} onChange={(event) => updateBlock({ ...block, title: event.target.value })} className={inspectorInputClass} /></label>
        <label className="block text-xs text-neutral-500">Description<textarea value={block.description} disabled={!editable} onChange={(event) => updateBlock({ ...block, description: event.target.value })} rows={4} className={inspectorTextareaClass} /></label>
        <p className="text-xs text-neutral-600">The Header block is required and always stays first.</p>
    </div>
    if (block.kind === "estimate") return <div className="space-y-4">
        <label className="block text-xs text-neutral-500">Estimated time<input value={block.estimatedTime} disabled={!editable} onChange={(event) => updateBlock({ ...block, estimatedTime: event.target.value })} placeholder="2–3 minutes" className={inspectorInputClass} /></label>
        <p className="text-xs text-neutral-600">The Estimated time block is required, but can be reordered and styled independently.</p>
    </div>
    if (block.kind === "checklist") return <div className="space-y-4">
        <label className="block text-xs text-neutral-500">Element name<input value={blockName(block)} disabled={!editable} onChange={(event) => updateBlock({ ...block, name: event.target.value })} className={inspectorInputClass} /></label>
        <label className="block text-xs text-neutral-500">Heading<input value={block.title} disabled={!editable} onChange={(event) => updateBlock({ ...block, title: event.target.value })} className={inspectorInputClass} /></label>
        <label className="block text-xs text-neutral-500">Items<select value={block.source} disabled={!editable} onChange={(event) => updateBlock({ ...block, source: event.target.value as "modules" | "custom" })} className={inspectorInputClass}><option value="custom">Custom checklist</option><option value="modules">Onboarding module names</option></select></label>
        {block.source === "custom" ? <div className="space-y-2">{block.items.map((item, index) => <div key={index} className="flex gap-2"><input aria-label={`Checklist item ${index + 1}`} value={item} disabled={!editable} onChange={(event) => updateBlock({ ...block, items: block.items.map((current, itemIndex) => itemIndex === index ? event.target.value : current) })} className={inspectorInputClass.replace("mt-1 ", "")} /><button type="button" aria-label={`Remove checklist item ${index + 1}`} disabled={!editable} onClick={() => updateBlock({ ...block, items: block.items.filter((_, itemIndex) => itemIndex !== index) })} className="h-9 px-2 text-neutral-500 hover:text-white">✕</button></div>)}<button type="button" disabled={!editable} onClick={() => updateBlock({ ...block, items: [...block.items, "New item"] })} className="h-9 w-full rounded-lg border border-neutral-700 text-xs disabled:opacity-30">Add item</button></div> : <p className="text-xs leading-5 text-neutral-600">This list automatically uses the modules included in the client’s onboarding.</p>}
        <label className="block text-xs text-neutral-500">Footer<textarea value={block.footer} disabled={!editable} onChange={(event) => updateBlock({ ...block, footer: event.target.value })} rows={3} className={inspectorTextareaClass} /></label>
        <button type="button" disabled={!editable} onClick={deleteSelection} className="text-xs text-red-300 disabled:opacity-30">Delete checklist</button>
    </div>
    if (block.kind === "form") return <div className="space-y-4">
        <label className="block text-xs text-neutral-500">Element name<input value={blockName(block)} disabled={!editable} onChange={(event) => updateBlock({ ...block, name: event.target.value })} className={inspectorInputClass} /></label>
        <label className="block text-xs text-neutral-500">Why we ask<textarea value={block.whyWeAsk} disabled={!editable} onChange={(event) => updateBlock({ ...block, whyWeAsk: event.target.value })} rows={4} className={inspectorTextareaClass} /></label>
        <button type="button" disabled={!editable} onClick={addField} className="h-9 w-full rounded-lg border border-neutral-700 text-xs disabled:opacity-30">Add field</button>
        <button type="button" disabled={!editable} onClick={deleteSelection} className="text-xs text-red-300 disabled:opacity-30">Delete form</button>
    </div>
    if (block.kind === "video") return <div className="space-y-4">
        <label className="block text-xs text-neutral-500">Element name<input value={blockName(block)} disabled={!editable} onChange={(event) => updateBlock({ ...block, name: event.target.value })} className={inspectorInputClass} /></label>
        <label className="block text-xs text-neutral-500">Video<span className="mt-1 flex min-h-9 items-center justify-between gap-2 rounded-lg border border-neutral-700 bg-black px-2 text-xs text-neutral-300"><span className="min-w-0 truncate">{block.upload?.name ?? "No video uploaded"}</span><span className="shrink-0 font-medium text-white">{block.upload ? "Replace" : "Upload"}</span></span><input type="file" accept="video/*" disabled={!editable} onChange={(event) => { const file = event.target.files?.[0]; if (file) uploadVideo(file); event.currentTarget.value = "" }} className="sr-only" /></label>
        <label className="flex items-center gap-2 rounded-lg border border-neutral-800 p-3 text-xs text-neutral-300"><input type="checkbox" checked={block.requirement === "finish"} disabled={!editable} onChange={(event) => updateBlock({ ...block, requirement: event.target.checked ? "finish" : "none" })} />Client must finish this video</label>
        <button type="button" disabled={!editable} onClick={deleteSelection} className="text-xs text-red-300 disabled:opacity-30">Delete video</button>
    </div>
    return <div className="space-y-4">
        <label className="block text-xs text-neutral-500">Element name<input value={blockName(block)} disabled={!editable} onChange={(event) => updateBlock({ ...block, name: event.target.value })} className={inspectorInputClass} /></label>
        <label className="block text-xs text-neutral-500">Button text<input value={block.label} disabled={!editable} onChange={(event) => updateBlock({ ...block, label: event.target.value })} className={inspectorInputClass} /></label>
        <label className="block text-xs text-neutral-500">Destination URL<input value={block.url} disabled={!editable} onChange={(event) => updateBlock({ ...block, url: event.target.value })} placeholder="https://…" className={inspectorInputClass} /></label>
        <label className="flex items-center gap-2 rounded-lg border border-neutral-800 p-3 text-xs text-neutral-300"><input type="checkbox" checked={block.required} disabled={!editable} onChange={(event) => updateBlock({ ...block, required: event.target.checked })} />Client must open this link</label>
        <button type="button" disabled={!editable} onClick={deleteSelection} className="text-xs text-red-300 disabled:opacity-30">Delete button</button>
    </div>
}

function BrandingInspector({ theme, updateThemeSwatch, addThemeSwatch, updateAssignment }: {
    theme: VisualBuilderDocument["theme"]
    updateThemeSwatch: (id: string, values: { name?: string; hex?: string; hidden?: boolean }) => void
    addThemeSwatch: () => void
    updateAssignment: (slot: OnboardingThemeSlot, swatchId: string) => void
}) {
    return <div data-builder-branding-styles className="space-y-4"><p className="text-xs leading-5 text-neutral-500">These six colours are shared with Agency Branding and client portals. Changes remain drafts until Publish.</p><section className="space-y-2 rounded-xl border border-neutral-800 p-2"><div className="flex items-center justify-between gap-2"><h3 className="text-xs font-semibold text-neutral-300">Colour palette</h3><button type="button" onClick={addThemeSwatch} className="text-[11px] text-neutral-300 underline underline-offset-4">Add colour</button></div>{theme.swatches.map((swatch) => <div key={swatch.id} className={`grid grid-cols-[2rem_minmax(0,1fr)_auto] items-center gap-2 ${swatch.hidden ? "opacity-50" : ""}`}><input type="color" aria-label={`${swatch.name} colour`} value={swatch.hex} onChange={(event) => updateThemeSwatch(swatch.id, { hex: event.target.value.toUpperCase() })} className="h-8 w-8 rounded border border-neutral-700 bg-transparent p-0" /><input value={swatch.name} onChange={(event) => updateThemeSwatch(swatch.id, { name: event.target.value })} aria-label="Colour name" className="h-8 min-w-0 rounded border border-neutral-700 bg-black px-2 text-xs text-white" /><button type="button" onClick={() => updateThemeSwatch(swatch.id, { hidden: !swatch.hidden })} className="text-[10px] text-neutral-400">{swatch.hidden ? "Restore" : "Hide"}</button></div>)}</section>{ONBOARDING_THEME_SLOTS.map((slot: OnboardingThemeSlot) => <label key={slot} className="block text-xs text-neutral-400">{ONBOARDING_THEME_SLOT_LABELS[slot]}<select value={theme.assignments[slot]} onChange={(event) => updateAssignment(slot, event.target.value)} className={inspectorInputClass}>{theme.swatches.filter((swatch) => !swatch.hidden || swatch.id === theme.assignments[slot]).map((swatch) => <option key={swatch.id} value={swatch.id}>{swatch.name}</option>)}</select></label>)}{onboardingThemeWarnings(theme).map((warning) => <p key={warning} className="rounded-lg border border-yellow-900 bg-yellow-950 p-2 text-[11px] text-yellow-200">{warning}</p>)}</div>
}

function StylesPanel({ block, field, theme, updateBlock, updateThemeSwatch, addThemeSwatch, updateAssignment }: {
    block: OnboardingBlock | null
    field: OnboardingField | null
    theme: VisualBuilderDocument["theme"]
    updateBlock: (block: OnboardingBlock) => void
    updateThemeSwatch: (id: string, values: { name?: string; hex?: string; hidden?: boolean }) => void
    addThemeSwatch: () => void
    updateAssignment: (slot: OnboardingThemeSlot, swatchId: string) => void
}) {
    if (!block || field) return <BrandingInspector theme={theme} updateThemeSwatch={updateThemeSwatch} addThemeSwatch={addThemeSwatch} updateAssignment={updateAssignment} />
    return <div data-builder-element-styles className="space-y-4">
        <div className="grid grid-cols-2 gap-2"><label className="text-xs text-neutral-500">Width<select value={block.layout.width} onChange={(event) => updateBlock({ ...block, layout: { ...block.layout, width: event.target.value as OnboardingBlock["layout"]["width"] } })} className={inspectorInputClass}><option value="narrow">Narrow</option><option value="standard">Standard</option><option value="wide">Wide</option><option value="full">Full</option></select></label><label className="text-xs text-neutral-500">Alignment<select value={block.layout.alignment} onChange={(event) => updateBlock({ ...block, layout: { ...block.layout, alignment: event.target.value as OnboardingBlock["layout"]["alignment"] } })} className={inspectorInputClass}><option value="left">Left</option><option value="center">Centre</option></select></label></div>
        <label className="block text-xs text-neutral-500">Gap before<select value={block.layout.spacingBefore} onChange={(event) => updateBlock({ ...block, layout: { ...block.layout, spacingBefore: event.target.value as OnboardingBlock["layout"]["spacingBefore"] } })} className={inspectorInputClass}><option value="compact">Compact</option><option value="normal">Normal</option><option value="spacious">Spacious</option></select></label>
        <label className="block text-xs text-neutral-500">Gap after<select value={block.layout.spacingAfter} onChange={(event) => updateBlock({ ...block, layout: { ...block.layout, spacingAfter: event.target.value as OnboardingBlock["layout"]["spacingAfter"] } })} className={inspectorInputClass}><option value="compact">Compact</option><option value="normal">Normal</option><option value="spacious">Spacious</option></select></label>
        {block.kind === "button" ? <label className="block text-xs text-neutral-500">Appearance<select value={block.appearance} onChange={(event) => updateBlock({ ...block, appearance: event.target.value as "primary" | "secondary" })} className={inspectorInputClass}><option value="primary">Primary</option><option value="secondary">Secondary</option></select></label> : null}
    </div>
}

function composeGroups(document: VisualBuilderDocument): DefinitionGroup[] {
    return document.modules.map((module) => ({ key: `module:${module.id}`, kind: "module" as const, title: module.name, definition: module }))
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

function ModulesPanel({ modules, services, editable, updateModule, removeModule, reorderModule }: {
    modules: OnboardingModuleDefinitionV2[]
    services: OnboardingBuilderData["services"]
    editable: boolean
    updateModule: (module: OnboardingModuleDefinitionV2) => void
    removeModule: (module: OnboardingModuleDefinitionV2) => void
    reorderModule: (moduleId: string, targetIndex: number) => void
}) {
    const [draggingModuleId, setDraggingModuleId] = useState<string | null>(null)
    function dropModule(event: DragEvent<HTMLElement>, targetIndex: number) {
        event.preventDefault()
        const moduleId = event.dataTransfer.getData("application/x-betelgeze-module")
        if (moduleId) reorderModule(moduleId, targetIndex)
        setDraggingModuleId(null)
    }
    return <div className="space-y-3">
        <p className="px-1 text-[11px] leading-4 text-neutral-500">Drag modules into their client-facing order. Mandatory modules always appear; other modules appear when a linked service is selected.</p>
        {modules.map((module, moduleIndex) => <Fragment key={module.id}><div className="h-2" onDragOver={(event) => event.preventDefault()} onDrop={(event) => dropModule(event, moduleIndex)} /><section draggable={editable} title="Drag to reorder module" onDragStart={(event) => { event.dataTransfer.setData("application/x-betelgeze-module", module.id); event.dataTransfer.effectAllowed = "move"; setDraggingModuleId(module.id) }} onDragEnd={() => setDraggingModuleId(null)} className={`space-y-3 rounded-xl border border-neutral-800 bg-black/40 p-3 transition ${editable ? "cursor-grab" : ""} ${draggingModuleId === module.id ? "opacity-40" : ""}`}>
            <div className="flex items-end gap-2"><label className="block min-w-0 flex-1 text-[11px] text-neutral-500">Module name<input value={module.name} disabled={!editable} onChange={(event) => updateModule({ ...module, name: event.target.value })} className="mt-1 h-9 w-full rounded-lg border border-neutral-700 bg-black px-2 text-xs text-white" /></label><button type="button" aria-label={`Delete ${module.name}`} title={`Delete ${module.name}`} disabled={!editable} onClick={() => removeModule(module)} className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-neutral-500 transition hover:bg-neutral-800 hover:text-red-300 disabled:opacity-30"><TrashIcon /></button></div>
            <label className="flex items-center gap-2 text-xs text-neutral-300"><input type="checkbox" checked={Boolean(module.mandatory)} disabled={!editable} onChange={(event) => updateModule({ ...module, mandatory: event.target.checked, serviceIds: event.target.checked ? [] : module.serviceIds })} />Mandatory</label>
            {!module.mandatory ? <fieldset disabled={!editable} className="space-y-2"><legend className="text-[11px] text-neutral-500">Linked services</legend>{services.filter((service) => service.state === "active").map((service) => <label key={service.id} className="flex items-center gap-2 text-xs text-neutral-300"><input type="checkbox" checked={module.serviceIds?.includes(service.id) ?? false} onChange={(event) => updateModule({ ...module, serviceIds: event.target.checked ? [...(module.serviceIds ?? []), service.id] : (module.serviceIds ?? []).filter((id) => id !== service.id) })} />{service.name}</label>)}</fieldset> : null}
        </section></Fragment>)}
        {modules.length ? <div className="h-2" onDragOver={(event) => event.preventDefault()} onDrop={(event) => dropModule(event, modules.length)} /> : null}
    </div>
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
    const builderPreferenceKey = `betelgeze:onboarding-builder:${workspaceSlug}`
    const groups = useMemo(() => composeGroups(collaboration.document), [collaboration.document])
    const [visibleModuleIds, setVisibleModuleIds] = useState<Set<string>>(() => new Set([
        ...(data.mandatory.draftModuleIds.length ? data.mandatory.draftModuleIds : data.mandatory.publishedModuleIds),
        ...data.visualModules.filter((module) => module.mandatory).map((module) => module.id),
        ...(data.selectedModule ? [data.selectedModule.id] : []),
    ]))
    const firstGroup = groups[0]
    const initialGroupKey = initialBookend ? `bookend:${initialBookend}` : data.selectedModule ? `module:${data.selectedModule.id}` : firstGroup?.key ?? "bookend:welcome"
    const initialGroup = groups.find((group) => group.key === initialGroupKey) ?? firstGroup
    const [selection, setSelection] = useState<Selection>({ groupKey: initialGroup?.key ?? "", stepId: initialGroup?.definition.steps[0]?.id ?? "", blockId: null })
    const [leftOpen, setLeftOpen] = useState(true)
    const [rightOpen, setRightOpen] = useState(true)
    const [leftTab, setLeftTab] = useState<LeftTab>("outline")
    const [rightTab, setRightTab] = useState<RightTab>("inspect")
    const [viewport, setViewport] = useState<"desktop" | "mobile">("desktop")
    const [preview, setPreview] = useState(false)
    const [publishOpen, setPublishOpen] = useState(false)
    const [applyToActive, setApplyToActive] = useState(false)
    const [explanation, setExplanation] = useState("We updated parts of your onboarding so we can collect the right information. Please review the affected sections again.")
    const [notice, setNotice] = useState<string | null>(null)
    const [error, setError] = useState<string | null>(null)
    const [pending, startTransition] = useTransition()
    const [helpPending, startHelpTransition] = useTransition()
    const [helpDraft, setHelpDraft] = useState(data.help)
    const [savedHelp, setSavedHelp] = useState(data.help)

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
                setLeftOpen(railPreference(`${builderPreferenceKey}:left`, true))
                setRightOpen(railPreference(`${builderPreferenceKey}:right`, true))
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
        updateActivity({ selection: selection.groupKey && selection.stepId ? `${selection.groupKey}:${selection.stepId}:${selection.blockId ?? "step"}${selection.fieldId ? `:${selection.fieldId}` : ""}` : null })
    }, [selection.blockId, selection.fieldId, selection.groupKey, selection.stepId, updateActivity])

    const resolved = selectedStep(groups, selection)
    const currentGroup = resolved.group
    const currentStep = resolved.step
    const helpSelected = selection.blockId === HELP_BLOCK_ID
    const selectedBlock = currentStep?.blocks.find((block) => block.id === selection.blockId) ?? null
    const selectedField = selectedBlock?.kind === "form" ? selectedBlock.fields.find((field) => field.id === selection.fieldId) ?? null : null
    const visibleGroups = groups.filter((group) => group.kind === "bookend" || visibleModuleIds.has(group.definition.id))
    const moduleTitles = visibleGroups.filter((group): group is Extract<DefinitionGroup, { kind: "module" }> => group.kind === "module").map((group) => group.title)
    const roadmapSteps = visibleGroups.flatMap((group) => group.definition.steps.map((step) => ({ key: `${group.key}:${step.id}`, title: visualStepTitle(step), complete: false, current: group.key === selection.groupKey && step.id === selection.stepId, href: null })))
    const baselineModules = new Map(data.visualModules.map((module) => [module.id, JSON.stringify(module)]))
    const dirtyModuleIds = collaboration.document.modules.filter((module) => JSON.stringify(module) !== baselineModules.get(module.id)).map((module) => module.id)
    const welcomeDirty = JSON.stringify(collaboration.document.welcome) !== JSON.stringify(data.visualWelcome)
    const completionDirty = JSON.stringify(collaboration.document.completion) !== JSON.stringify(data.visualCompletion)
    const themeDirty = JSON.stringify(collaboration.document.theme) !== JSON.stringify(data.theme)
    const helpDirty = helpDraft.text.trim() !== savedHelp.text.trim() || helpDraft.whatsappEnabled !== savedHelp.whatsappEnabled

    function rememberRail(side: "left" | "right", open: boolean) {
        window.localStorage.setItem(`${builderPreferenceKey}:${side}`, open ? "open" : "collapsed")
        if (side === "left") setLeftOpen(open); else setRightOpen(open)
    }

    function saveHelp() {
        startHelpTransition(async () => {
            setError(null)
            const outcome = await saveOnboardingHelpSettings(workspaceSlug, helpDraft.text, helpDraft.whatsappEnabled)
            if (!outcome.ok) { setError(outcome.error); return }
            setSavedHelp(helpDraft)
            setNotice("Client help saved live.")
        })
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

    function reorderModule(moduleId: string, targetIndex: number) {
        collaboration.updateDocument((document) => {
            const sourceIndex = document.modules.findIndex((module) => module.id === moduleId)
            if (sourceIndex < 0) return document
            const modules = [...document.modules]
            const [moved] = modules.splice(sourceIndex, 1)
            const adjustedIndex = sourceIndex < targetIndex ? targetIndex - 1 : targetIndex
            modules.splice(Math.max(0, Math.min(adjustedIndex, modules.length)), 0, moved)
            return { ...document, modules: modules.map((module, index) => ({ ...module, sortOrder: index * 10 })) }
        })
    }

    function moveStep(sourceGroupKey: string, targetGroupKey: string, stepId: string, targetIndex: number, copy: boolean) {
        const moved: { step: OnboardingStepV2 | null } = { step: null }
        collaboration.updateDocument((document) => {
            const source = documentDefinition(document, sourceGroupKey)
            const target = documentDefinition(document, targetGroupKey)
            const sourceStep = source?.steps.find((step) => step.id === stepId)
            if (!source || !target || !sourceStep) return document
            if (!copy && source.steps.length === 1) {
                setError(sourceGroupKey.startsWith("bookend:") ? "Each bookend must retain at least one step." : "Each module must retain at least one step.")
                return document
            }
            moved.step = copy ? duplicateStep(sourceStep, nextDuplicateName(visualStepTitle(sourceStep), target.steps.map(visualStepTitle))) : sourceStep
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

    function moveBlock(sourceGroupKey: string, sourceStepId: string, blockId: string, targetGroupKey: string, targetStepId: string, targetIndex: number, copy: boolean) {
        const moved: { block: OnboardingBlock | null } = { block: null }
        collaboration.updateDocument((document) => {
            const source = documentDefinition(document, sourceGroupKey)
            const target = documentDefinition(document, targetGroupKey)
            const sourceStep = source?.steps.find((step) => step.id === sourceStepId)
            const targetStep = target?.steps.find((step) => step.id === targetStepId)
            const sourceBlock = sourceStep?.blocks.find((block) => block.id === blockId)
            if (!source || !target || !sourceStep || !targetStep || !sourceBlock || sourceBlock.kind === "header") return document
            const movingWithinSameStep = !copy && sourceGroupKey === targetGroupKey && sourceStepId === targetStepId
            if (targetStep.blocks.some((block) => block.kind === sourceBlock.kind && !(movingWithinSameStep && block.id === sourceBlock.id))) {
                setError(`A step can contain only one ${blockName(sourceBlock)} block.`)
                return document
            }
            moved.block = copy ? duplicateBlock(sourceBlock, nextDuplicateName(blockName(sourceBlock), targetStep.blocks.map(blockName))) : sourceBlock
            if (sourceGroupKey === targetGroupKey && sourceStepId === targetStepId) {
                const blocks = [...sourceStep.blocks]
                const sourceIndex = blocks.findIndex((block) => block.id === blockId)
                if (!copy) blocks.splice(sourceIndex, 1)
                const adjustedIndex = !copy && sourceIndex < targetIndex ? targetIndex - 1 : targetIndex
                blocks.splice(Math.max(1, Math.min(adjustedIndex, blocks.length)), 0, moved.block)
                return replaceDocumentDefinition(document, sourceGroupKey, { ...source, steps: source.steps.map((step) => step.id === sourceStepId ? { ...step, blocks } : step) })
            }
            const sourceSteps = source.steps.map((step) => step.id === sourceStepId && !copy ? { ...step, blocks: step.blocks.filter((block) => block.id !== blockId) } : step)
            let next = replaceDocumentDefinition(document, sourceGroupKey, { ...source, steps: sourceSteps })
            const nextTarget = documentDefinition(next, targetGroupKey)
            if (!nextTarget) return document
            const targetSteps = nextTarget.steps.map((step) => step.id === targetStepId
                ? { ...step, blocks: [...step.blocks.slice(0, Math.max(1, Math.min(targetIndex, step.blocks.length))), moved.block!, ...step.blocks.slice(Math.max(1, Math.min(targetIndex, step.blocks.length)))] }
                : step)
            next = replaceDocumentDefinition(next, targetGroupKey, { ...nextTarget, steps: targetSteps })
            return linkDefinitions(next, sourceGroupKey, targetGroupKey)
        })
        if (moved.block) setSelection({ groupKey: targetGroupKey, stepId: targetStepId, blockId: moved.block.id })
    }

    function moveField(groupKey: string, stepId: string, formBlockId: string, fieldId: string, targetIndex: number, copy: boolean) {
        let movedFieldId: string | null = null
        updateDefinition(groupKey, (definition) => ({
            ...definition,
            steps: definition.steps.map((step) => {
                if (step.id !== stepId) return step
                return { ...step, blocks: step.blocks.map((block) => {
                    if (block.id !== formBlockId || block.kind !== "form") return block
                    const sourceIndex = block.fields.findIndex((field) => field.id === fieldId)
                    if (sourceIndex < 0) return block
                    const fields = [...block.fields]
                    const source = fields[sourceIndex]
                    const moved = copy ? { ...duplicateField(source), label: nextDuplicateName(source.label || "Untitled field", fields.map((field) => field.label)) } : source
                    movedFieldId = moved.id
                    if (!copy) fields.splice(sourceIndex, 1)
                    const adjustedIndex = !copy && sourceIndex < targetIndex ? targetIndex - 1 : targetIndex
                    fields.splice(Math.max(0, Math.min(adjustedIndex, fields.length)), 0, moved)
                    return { ...block, fields }
                }) }
            }),
        }))
        if (movedFieldId) setSelection({ groupKey, stepId, blockId: formBlockId, fieldId: movedFieldId })
    }

    function acceptStructureDrop(event: DragEvent<HTMLElement>, target: OutlineDropTarget) {
        const raw = event.dataTransfer.getData("application/x-betelgeze-builder-item")
        if (!raw) return
        event.preventDefault()
        try {
            const payload = JSON.parse(raw) as { type: "module" | "step" | "block" | "field" | "library"; moduleId?: string; groupKey?: string; stepId?: string; blockId?: string; formBlockId?: string; fieldId?: string; kind?: "estimate" | "checklist" | "form" | "video" | "button"; copy?: boolean }
            if (payload.type === "module" && payload.moduleId && target.moduleIndex !== undefined) reorderModule(payload.moduleId, target.moduleIndex)
            else if (payload.type === "step" && payload.groupKey && payload.stepId && target.stepIndex !== undefined) moveStep(payload.groupKey, target.groupKey, payload.stepId, target.stepIndex, Boolean(payload.copy))
            else if (payload.type === "block" && payload.groupKey && payload.stepId && payload.blockId && target.stepId) moveBlock(payload.groupKey, payload.stepId, payload.blockId, target.groupKey, target.stepId, target.blockIndex ?? Number.MAX_SAFE_INTEGER, Boolean(payload.copy))
            else if (payload.type === "field" && payload.groupKey && payload.stepId && payload.formBlockId && payload.fieldId && target.formBlockId && target.fieldIndex !== undefined) {
                if (payload.groupKey !== target.groupKey || payload.stepId !== target.stepId || payload.formBlockId !== target.formBlockId) {
                    setError("Fields must stay inside their form.")
                    return
                }
                moveField(target.groupKey, target.stepId!, target.formBlockId, payload.fieldId, target.fieldIndex, Boolean(payload.copy))
            } else if (payload.type === "library" && payload.kind && target.stepId) {
                const block = payload.kind === "estimate" ? createEstimateBlock() : payload.kind === "checklist" ? createChecklistBlock() : payload.kind === "form" ? createFormBlock() : payload.kind === "video" ? createVideoBlock() : createButtonBlock()
                let inserted = false
                collaboration.updateDocument((document) => {
                    const targetDefinition = documentDefinition(document, target.groupKey)
                    const targetStep = targetDefinition?.steps.find((step) => step.id === target.stepId)
                    if (!targetDefinition || !targetStep) return document
                    if (targetStep.blocks.some((candidate) => candidate.kind === payload.kind)) {
                        setError(`That step already has a ${payload.kind === "estimate" ? "Estimated time" : payload.kind} block.`)
                        return document
                    }
                    inserted = true
                    const insertionIndex = Math.max(1, Math.min(target.blockIndex ?? targetStep.blocks.length, targetStep.blocks.length))
                    const steps = targetDefinition.steps.map((step) => step.id === target.stepId ? { ...step, blocks: [...step.blocks.slice(0, insertionIndex), block, ...step.blocks.slice(insertionIndex)] } : step)
                    return replaceDocumentDefinition(document, target.groupKey, { ...targetDefinition, steps })
                })
                if (inserted) setSelection({ groupKey: target.groupKey, stepId: target.stepId, blockId: block.id })
            }
        } catch { setError("That Builder item could not be moved.") }
    }

    function chooseGroup(group: DefinitionGroup) {
        setSelection({ groupKey: group.key, stepId: group.definition.steps[0]?.id ?? "", blockId: null })
        collaboration.updateActivity({ selection: group.key })
    }

    function selectRoadmapStep(key: string) {
        for (const group of visibleGroups) {
            const step = group.definition.steps.find((candidate) => `${group.key}:${candidate.id}` === key)
            if (step) {
                setSelection({ groupKey: group.key, stepId: step.id, blockId: null })
                setRightTab("inspect")
                return
            }
        }
    }

    function toggleModuleVisibility(moduleId: string) {
        const next = new Set(visibleModuleIds)
        if (next.has(moduleId)) next.delete(moduleId); else next.add(moduleId)
        setVisibleModuleIds(next)
        if (selection.groupKey === `module:${moduleId}` && !next.has(moduleId)) {
            const fallback = groups.find((group) => group.kind === "bookend" || next.has(group.definition.id))
            if (fallback) chooseGroup(fallback)
        }
    }

    function confirmDeleteSelection() {
        if (!collaboration.editable || !currentGroup || !currentStep) return
        const label = selectedField?.label || (selectedBlock ? selectedBlock.kind : visualStepTitle(currentStep))
        if (!window.confirm(`Delete ${label}? This change can be undone with the Builder undo control.`)) return
        if (selectedField && selectedBlock?.kind === "form") {
            updateBlock({ ...selectedBlock, fields: selectedBlock.fields.filter((field) => field.id !== selectedField.id) })
            setSelection({ ...selection, fieldId: null })
        } else if (selectedBlock && selectedBlock.kind !== "header" && selectedBlock.kind !== "estimate") {
            removeBlock()
        } else if (!selectedBlock) {
            removeCurrentStep()
        }
    }

    function createModule() {
        startTransition(async () => {
            const outcome = await createOnboardingModule(workspaceSlug)
            if (!outcome.ok) setError(outcome.error)
            else window.location.href = `/${workspaceSlug}/onboarding-builder?module=${outcome.data?.module_id}`
        })
    }

    function removeModule(module: OnboardingModuleDefinitionV2) {
        if (!collaboration.editable) return
        if (!window.confirm(`Delete “${module.name}”? Published modules are removed from future onboarding but remain frozen inside existing client sessions.`)) return
        setError(null)
        startTransition(async () => {
            const outcome = await removeOnboardingModule(workspaceSlug, module.id)
            if (!outcome.ok) {
                setError(outcome.error)
                return
            }
            collaboration.updateDocument((document) => ({ ...document, modules: document.modules.filter((candidate) => candidate.id !== module.id) }))
            setVisibleModuleIds((current) => {
                const next = new Set(current)
                next.delete(module.id)
                return next
            })
            if (selection.groupKey === `module:${module.id}`) {
                const fallback = groups.find((group) => group.key !== `module:${module.id}`)
                setSelection({ groupKey: fallback?.key ?? "", stepId: fallback?.definition.steps[0]?.id ?? "", blockId: null })
            }
            setNotice(outcome.data?.mode === "deleted" ? "Module deleted." : "Module removed from future onboarding.")
        })
    }

    function addStep() {
        if (!currentGroup) return
        const step = createOnboardingStepV2({ bookend: currentGroup.kind === "bookend", title: currentGroup.kind === "bookend" ? `New ${currentGroup.title.toLowerCase()} step` : "Untitled step", showComposedModuleSummary: currentGroup.key === "bookend:welcome" && currentGroup.definition.steps.length === 0 })
        updateDefinition(currentGroup.key, (definition) => ({ ...definition, steps: [...definition.steps, step] }))
        setSelection({ groupKey: currentGroup.key, stepId: step.id, blockId: step.blocks[0].id })
    }

    function addBlock(kind: "estimate" | "checklist" | "form" | "video" | "button") {
        if (!currentStep || !currentGroup) return
        if (currentStep.blocks.some((block) => block.kind === kind)) {
            setError(`This step already contains a ${kind === "estimate" ? "Estimated time" : kind} block.`)
            return
        }
        const block = kind === "estimate" ? createEstimateBlock() : kind === "checklist" ? createChecklistBlock() : kind === "form" ? createFormBlock() : kind === "video" ? createVideoBlock() : createButtonBlock()
        updateCurrentStep({ ...currentStep, blocks: [...currentStep.blocks, block] })
        setSelection({ ...selection, blockId: block.id })
    }

    function updateBlock(block: OnboardingBlock) {
        if (!currentStep) return
        updateCurrentStep({ ...currentStep, blocks: currentStep.blocks.map((item) => item.id === block.id ? block : item) })
    }

    function updateSelectedField(values: Partial<OnboardingField>) {
        if (!selectedField || selectedBlock?.kind !== "form") return
        updateBlock({ ...selectedBlock, fields: selectedBlock.fields.map((field) => field.id === selectedField.id ? { ...field, ...values } : field) })
    }

    function addFieldToSelectedForm() {
        if (selectedBlock?.kind !== "form") return
        const field = createOnboardingField()
        updateBlock({ ...selectedBlock, fields: [...selectedBlock.fields, field] })
        setSelection({ ...selection, fieldId: field.id })
    }

    async function uploadSelectedVideo(file: File) {
        if (!currentGroup || selectedBlock?.kind !== "video") return
        setError(null)
        try {
            const target = currentGroup.kind === "module" ? { kind: "module" as const, definition: currentGroup.definition } : { kind: "bookend" as const, definition: currentGroup.definition }
            const prepared = await prepareVisualBuilderVideoUpload(workspaceSlug, target, { name: file.name, size: file.size, type: file.type })
            const response = await fetch(prepared.uploadUrl, { method: "PUT", headers: { "Content-Type": file.type }, body: file })
            if (!response.ok) throw new Error(`Upload failed with status ${response.status}.`)
            updateCurrentRevisionId(prepared.draftRevisionId)
            updateBlock({ ...selectedBlock, legacyEmbedUrl: null, upload: { ...prepared.storedVideo, resolvedUrl: prepared.previewUrl } } satisfies VideoBlock)
        } catch (uploadError) {
            setError(uploadError instanceof Error ? uploadError.message : "Video upload failed.")
        }
    }

    function removeBlock() {
        if (!currentStep || !selectedBlock || selectedBlock.kind === "header" || selectedBlock.kind === "estimate") return
        updateCurrentStep({ ...currentStep, blocks: currentStep.blocks.filter((block) => block.id !== selectedBlock.id) })
        setSelection({ ...selection, blockId: null, fieldId: null })
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
        const included = new Set<string>([...dirtyModuleIds, "bookend:welcome", "bookend:completion"])
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
            theme: themeDirty ? collaboration.document.theme : null,
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
        const snapshot = { schemaVersion: 2, workspaceName, serviceIds: [], modules: visibleGroups.filter((group): group is Extract<DefinitionGroup, { kind: "module" }> => group.kind === "module").map((group) => group.definition), welcome: collaboration.document.welcome, completion: collaboration.document.completion, theme: collaboration.document.theme, help: helpDraft }
        const outcome = await rotateVisualOnboardingPreview(workspaceSlug, snapshot)
        if (!outcome.ok) { setError(outcome.error); return }
        const url = `${window.location.origin}/onboarding/preview/${outcome.data.token}`
        await navigator.clipboard.writeText(url)
        setNotice("Frozen 24-hour preview link copied.")
    }

    if (preview) return <div data-builder-fullscreen-preview className="relative flex h-dvh w-full items-stretch justify-center overflow-hidden bg-black">
        <button type="button" onClick={() => setPreview(false)} className="fixed right-4 top-4 z-[100] rounded-full border border-white/20 bg-black/70 px-4 py-2 text-xs font-semibold text-white shadow-lg backdrop-blur transition hover:bg-black focus:outline-none focus:ring-2 focus:ring-white/70">Exit preview</button>
        {currentGroup && currentStep ? <VisualBuilderCanvas workspaceSlug={workspaceSlug} workspaceName={workspaceName} groupKey={currentGroup.key} target={currentGroup.kind === "module" ? { kind: "module", definition: currentGroup.definition } : { kind: "bookend", definition: currentGroup.definition }} step={currentStep} roadmapSteps={roadmapSteps} moduleTitles={moduleTitles} theme={collaboration.document.theme} help={helpDraft} selectedBlockId={null} selectedFieldId={null} selectBlock={() => undefined} selectField={() => undefined} selectHelp={() => undefined} helpSelected={false} selectRoadmapStep={selectRoadmapStep} updateStep={() => undefined} updateDraftRevisionId={() => undefined} viewport={viewport} readOnly fullScreen /> : <div className="flex h-full items-center justify-center text-sm text-white/60">Choose or create a module to preview.</div>}
    </div>

    return <div onPointerMove={(event) => collaboration.updateActivity({ cursor: normalizedBuilderCursor(event.clientX, event.clientY, window.innerWidth, window.innerHeight) })} onPointerLeave={() => collaboration.updateActivity({ cursor: null })} className="flex h-dvh min-h-[42rem] flex-col overflow-hidden bg-neutral-950 text-white">
        <header className="flex h-14 shrink-0 items-center gap-2 border-b border-neutral-800 bg-black px-3 sm:px-4">
            <a href={`/${workspaceSlug}/settings#onboarding`} className="inline-flex h-9 items-center gap-2 rounded-lg px-2 text-sm text-neutral-400 hover:bg-neutral-900 hover:text-white"><BuilderIcon name="back" /><span className="hidden sm:inline">Back to Betelgeze</span></a>
            <span className="hidden h-5 w-px bg-neutral-800 sm:block" />
            <div className="min-w-0"><p className="truncate text-sm font-medium">Onboarding Builder</p><p className="hidden text-[11px] text-neutral-600 sm:block">{workspaceName}</p></div>
            <div className="ml-1 hidden items-center sm:flex"><BuilderNavigationButton label="Go back" onClick={() => window.history.back()}><BuilderNavigationIcon name="back" /></BuilderNavigationButton><BuilderNavigationButton label="Go forward" onClick={() => window.history.forward()}><BuilderNavigationIcon name="forward" /></BuilderNavigationButton><BuilderNavigationButton label="Reload Builder" onClick={() => window.location.reload()}><BuilderNavigationIcon name="reload" /></BuilderNavigationButton></div>
            <div className="ml-auto flex items-center gap-1.5">
                <div aria-label="Builder collaborators" className="flex items-center -space-x-1.5">{collaborators.map((person) => <span key={person.id} title={`${person.name} — ${person.connected ? "Connected" : "Disconnected"}`} className="flex h-7 w-7 shrink-0 items-center justify-center overflow-hidden rounded-full border-2 bg-neutral-900 transition" style={{ borderColor: person.color }}><span className={`h-full w-full transition ${person.connected ? "" : "grayscale opacity-40"}`}><Avatar src={person.avatarSrc} name={person.name} className="h-full w-full" /></span></span>)}</div>
                <span className="text-[11px] text-neutral-500"><Status label={saveStatus.label} tone={saveStatus.tone} /></span>
                <div className="hidden items-center rounded-lg border border-neutral-800 p-0.5 sm:flex"><button data-builder-viewport-toggle type="button" aria-label="Desktop preview" onClick={() => setViewport("desktop")} className={`inline-flex h-8 w-8 items-center justify-center rounded-md leading-none ${viewport === "desktop" ? "bg-neutral-800 text-white" : "text-neutral-500"}`}><BuilderIcon name="desktop" /></button><button data-builder-viewport-toggle type="button" aria-label="Mobile preview" onClick={() => setViewport("mobile")} className={`inline-flex h-8 w-8 items-center justify-center rounded-md leading-none ${viewport === "mobile" ? "bg-neutral-800 text-white" : "text-neutral-500"}`}><BuilderIcon name="mobile" /></button></div>
                <button type="button" onClick={() => setPreview((value) => !value)} className="inline-flex h-9 items-center justify-center gap-2 rounded-lg border border-neutral-700 px-3 text-xs font-medium leading-none text-neutral-200"><BuilderIcon name="preview" />{preview ? "Edit" : "Preview"}</button>
                <button type="button" disabled={!publishCount || !collaboration.editable} onClick={() => setPublishOpen(true)} className="inline-flex h-9 items-center justify-center gap-2 rounded-lg bg-white px-3 text-xs font-semibold leading-none text-black disabled:opacity-30"><BuilderIcon name="publish" />Publish{publishCount ? ` ${publishCount}` : ""}</button>
            </div>
        </header>

        {notice || error ? <div className={`shrink-0 border-b px-4 py-2 text-center text-xs ${error ? "border-red-900 bg-red-950 text-red-200" : "border-emerald-900 bg-emerald-950 text-emerald-200"}`}>{error ?? notice}</div> : null}
        {!data.schemaReady ? <div className="border-b border-yellow-800 bg-yellow-950 px-4 py-2 text-center text-xs text-yellow-100">The visual Builder schema must be deployed before edits can be published.</div> : null}

        <div className={`grid min-h-0 flex-1 ${preview ? "grid-cols-1" : builderGridColumns}`}>
            {!preview ? <aside className={`min-h-0 border-r border-neutral-800 bg-neutral-950 ${leftOpen ? "hidden md:flex md:flex-col" : "hidden md:flex md:items-start md:justify-center md:pt-3"}`}>
                {leftOpen ? <>
                    <div data-builder-left-rail-header className="flex h-12 items-center gap-1 border-b border-neutral-800 px-2">
                        <RailToggleButton side="left" label="Collapse left rail" onClick={() => rememberRail("left", false)} />
                        <button type="button" onClick={() => setLeftTab("outline")} className={`h-8 rounded-md px-2 text-xs ${leftTab === "outline" ? "bg-neutral-800 text-white" : "text-neutral-500"}`}>Outline</button>
                        <button type="button" onClick={() => setLeftTab("blocks")} className={`h-8 rounded-md px-2 text-xs ${leftTab === "blocks" ? "bg-neutral-800 text-white" : "text-neutral-500"}`}>Blocks</button>
                        <button type="button" onClick={() => setLeftTab("modules")} className={`h-8 rounded-md px-2 text-xs ${leftTab === "modules" ? "bg-neutral-800 text-white" : "text-neutral-500"}`}>Modules</button>
                    </div>
                    <div className="min-h-0 flex-1 overflow-y-auto p-2">
                        {leftTab === "modules" ? <ModulesPanel modules={collaboration.document.modules} services={data.services} editable={collaboration.editable} removeModule={removeModule} reorderModule={reorderModule} updateModule={(module) => collaboration.updateDocument((document) => ({ ...document, modules: document.modules.map((candidate) => candidate.id === module.id ? module : candidate) }))} /> : null}
                        <div className={leftTab === "modules" ? "hidden" : "contents"}>
                        {leftTab === "outline" ? <>
                            <div className="mb-2 px-1"><p className="text-[11px] text-neutral-600">Drag modules to order them · Cmd/Ctrl-drag steps and elements to duplicate</p></div>
                            <OutlineTree groups={groups} visibleModuleIds={visibleModuleIds} selection={selection} editable={collaboration.editable} onSelectStep={(groupKey, stepId) => { setSelection({ groupKey, stepId, blockId: null }); setRightTab("inspect") }} onSelectBlock={(groupKey, stepId, blockId) => { setSelection({ groupKey, stepId, blockId, fieldId: null }); setRightTab("inspect") }} onSelectField={(groupKey, stepId, blockId, fieldId) => { setSelection({ groupKey, stepId, blockId, fieldId }); setRightTab("inspect") }} onSelectHelp={() => { setSelection({ ...selection, blockId: HELP_BLOCK_ID, fieldId: null }); setRightTab("inspect") }} onToggleModule={toggleModuleVisibility} onDeleteSelection={confirmDeleteSelection} onDrop={acceptStructureDrop} />
                        </> : <div className="space-y-2"><p className="px-2 text-xs text-neutral-500">Drag a block into any step. Each block type can appear once per step, or click to append to the selected step.</p><button type="button" disabled className="flex w-full items-center gap-3 rounded-xl border border-neutral-800 bg-black p-3 text-left opacity-50"><span className="text-lg">H</span><span><b className="block text-sm">Header block</b><small className="text-neutral-600">Required at the top</small></span></button>{(["estimate", "checklist", "form", "video", "button"] as const).map((kind) => <button key={kind} type="button" draggable={collaboration.editable} disabled={!collaboration.editable} onDragStart={(event) => { event.dataTransfer.setData("application/x-betelgeze-builder-item", JSON.stringify({ type: "library", kind })); event.dataTransfer.effectAllowed = "copy" }} onClick={() => addBlock(kind)} className="flex w-full cursor-grab items-center gap-3 rounded-xl border border-neutral-800 bg-black p-3 text-left capitalize hover:border-neutral-600 disabled:cursor-not-allowed disabled:opacity-30"><span className="flex h-8 w-8 items-center justify-center rounded-lg bg-neutral-800 text-sm">{kind === "estimate" ? "◷" : kind === "checklist" ? "✓" : kind === "form" ? "▤" : kind === "video" ? "▶" : "↗"}</span><span className="text-sm">{kind === "estimate" ? "Estimated time" : kind}</span></button>)}<button type="button" disabled className="flex w-full items-center gap-3 rounded-xl border border-dashed border-neutral-800 p-3 text-left opacity-40"><span className="flex h-8 w-8 items-center justify-center rounded-lg bg-neutral-900">▦</span><span><b className="block text-sm">Calendar</b><small>Coming later</small></span></button></div>}
                        </div>
                    </div>
                    {leftTab === "outline" ? <div className="border-t border-neutral-800 p-2"><button type="button" disabled={!currentGroup || !collaboration.editable} onClick={addStep} className="h-9 w-full rounded-lg border border-neutral-700 text-xs text-neutral-300">Add step</button></div> : leftTab === "modules" ? <div className="border-t border-neutral-800 p-2"><button type="button" disabled={pending || !collaboration.editable} onClick={createModule} className="h-9 w-full rounded-lg border border-neutral-700 text-xs text-neutral-300 disabled:opacity-30">Add module</button></div> : null}
                </> : <RailToggleButton side="left" label="Expand left rail" onClick={() => rememberRail("left", true)} />}
            </aside> : null}

            <main className="min-h-0 overflow-auto bg-neutral-900/50 p-3 sm:p-5">
                {currentGroup && currentStep ? <VisualBuilderCanvas workspaceSlug={workspaceSlug} workspaceName={workspaceName} groupKey={currentGroup.key} target={currentGroup.kind === "module" ? { kind: "module", definition: currentGroup.definition } : { kind: "bookend", definition: currentGroup.definition }} step={currentStep} roadmapSteps={roadmapSteps} moduleTitles={moduleTitles} theme={collaboration.document.theme} help={helpDraft} selectedBlockId={selection.blockId} selectedFieldId={selection.fieldId ?? null} selectBlock={(blockId) => { setSelection({ ...selection, blockId, fieldId: null }); setRightTab("inspect") }} selectField={(blockId, fieldId) => { setSelection({ ...selection, blockId, fieldId }); setRightTab("inspect") }} selectHelp={() => { setSelection({ ...selection, blockId: HELP_BLOCK_ID, fieldId: null }); setRightTab("inspect") }} helpSelected={helpSelected} selectRoadmapStep={selectRoadmapStep} updateStep={updateCurrentStep} updateDraftRevisionId={updateCurrentRevisionId} viewport={viewport} collaboratorSelections={collaboration.presence} /> : <div className="flex h-full items-center justify-center text-sm text-neutral-500">Show a module or choose a bookend to start building.</div>}
            </main>

            {!preview ? <aside className={`min-h-0 border-l border-neutral-800 bg-neutral-950 ${rightOpen ? "hidden xl:flex xl:flex-col" : "hidden xl:flex xl:items-start xl:justify-center xl:pt-3"}`}>
                {rightOpen ? <>
                    <div data-builder-right-rail-header className="flex h-12 items-center gap-1 border-b border-neutral-800 px-2"><button type="button" onClick={() => setRightTab("inspect")} className={`h-8 rounded-md px-2 text-xs ${rightTab === "inspect" ? "bg-neutral-800 text-white" : "text-neutral-500"}`}>Inspect</button><button type="button" onClick={() => setRightTab("styles")} className={`h-8 rounded-md px-2 text-xs ${rightTab === "styles" ? "bg-neutral-800 text-white" : "text-neutral-500"}`}>Styles</button><span className="ml-auto"><RailToggleButton side="right" label="Collapse right rail" onClick={() => rememberRail("right", false)} /></span></div>
                    <div className="min-h-0 flex-1 overflow-y-auto p-3">{rightTab === "inspect" ? <InspectorPanel currentGroup={currentGroup} step={currentStep} block={selectedBlock} field={selectedField} help={helpDraft} helpSelected={helpSelected} helpDirty={helpDirty} helpPending={helpPending} editable={collaboration.editable} updateStep={updateCurrentStep} updateBlock={updateBlock} updateField={updateSelectedField} updateHelp={(values) => setHelpDraft((current) => ({ ...current, ...values }))} saveHelp={saveHelp} addField={addFieldToSelectedForm} uploadVideo={(file) => void uploadSelectedVideo(file)} deleteSelection={confirmDeleteSelection} /> : <StylesPanel block={selectedBlock} field={selectedField} theme={collaboration.document.theme} updateBlock={updateBlock} updateThemeSwatch={updateThemeSwatch} addThemeSwatch={addThemeSwatch} updateAssignment={(slot, swatchId) => collaboration.updateDocument((document) => ({ ...document, theme: { ...document.theme, assignments: { ...document.theme.assignments, [slot]: swatchId } } }))} />}</div>
                </> : <RailToggleButton side="right" label="Expand right rail" onClick={() => rememberRail("right", true)} />}
            </aside> : null}
        </div>
        {!preview ? collaboration.presence.filter((person) => person.cursor).map((person) => <div key={`cursor:${person.clientId}`} className="pointer-events-none fixed z-[80] flex items-center gap-1" style={{ left: `${person.cursor!.xRatio * 100}vw`, top: `${person.cursor!.yRatio * 100}vh`, color: person.color }}><span className="h-3 w-3 -translate-x-0.5 -translate-y-0.5 rotate-45 border-l-2 border-t-2" /><span className="rounded px-1 py-0.5 text-[10px] font-semibold text-black" style={{ backgroundColor: person.color }}>{person.name}</span></div>) : null}

        {publishOpen ? <div role="dialog" aria-modal="true" aria-labelledby="publish-title" className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"><section className="max-h-[90dvh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-neutral-700 bg-neutral-950 p-5 shadow-2xl"><div className="flex items-start justify-between gap-4"><div><h2 id="publish-title" className="text-lg font-semibold">Review onboarding release</h2><p className="mt-1 text-sm text-neutral-500">One transaction publishes every item below or rolls everything back.</p></div><button type="button" onClick={() => setPublishOpen(false)} className="text-neutral-500">✕</button></div><div className="mt-5 space-y-2">{publishScope.modules.map((module) => <div key={module.id} className="rounded-xl border border-neutral-800 bg-black p-3"><p className="text-sm font-medium">{module.name}</p><p className="mt-1 text-xs text-neutral-600">{module.steps.length} steps · visual module draft</p></div>)}{publishScope.bookends.map((bookend) => <div key={bookend.kind} className="rounded-xl border border-neutral-800 bg-black p-3"><p className="text-sm font-medium capitalize">{bookend.kind}</p><p className="mt-1 text-xs text-neutral-600">{bookend.steps.length} steps · {bookend.kind === "welcome" ? "future sessions only" : "future and active-incomplete sessions"}</p></div>)}{publishScope.theme ? <div className="rounded-xl border border-yellow-800 bg-yellow-950/40 p-3"><p className="text-sm font-medium text-yellow-100">Global Style</p><p className="mt-1 text-xs leading-5 text-yellow-200/70">Publishing colours immediately updates active and completed onboarding sessions and later client portal surfaces.</p></div> : null}</div><fieldset className="mt-5 space-y-2"><legend className="text-sm font-medium">Client scope</legend><label className="flex gap-3 rounded-xl border border-neutral-800 p-3 text-sm"><input type="radio" checked={!applyToActive} onChange={() => setApplyToActive(false)} />Future sessions only</label><label className="flex gap-3 rounded-xl border border-neutral-800 p-3 text-sm"><input type="radio" checked={applyToActive} onChange={() => setApplyToActive(true)} />Future + all affected active sessions</label></fieldset>{applyToActive ? <label className="mt-4 block text-sm text-neutral-400">Client explanation<textarea value={explanation} onChange={(event) => setExplanation(event.target.value)} rows={3} className="mt-2 w-full rounded-xl border border-neutral-700 bg-black p-3 text-white" /></label> : null}{error ? <p className="mt-3 text-sm text-red-300">{error}</p> : null}<div className="mt-5 flex flex-wrap justify-between gap-2"><button type="button" onClick={() => void createPreviewLink()} className="h-10 rounded-lg border border-neutral-700 px-3 text-sm">Copy frozen preview link</button><div className="flex gap-2"><button type="button" onClick={() => setPublishOpen(false)} className="h-10 rounded-lg border border-neutral-700 px-4 text-sm">Cancel</button><button type="button" disabled={pending || !publishCount} onClick={() => startTransition(publishChanges)} className="h-10 rounded-lg bg-white px-4 text-sm font-semibold text-black disabled:opacity-30">{pending ? "Publishing…" : "Publish release"}</button></div></div></section></div> : null}
    </div>
}
