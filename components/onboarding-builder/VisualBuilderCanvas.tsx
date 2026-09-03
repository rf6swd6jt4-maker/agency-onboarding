"use client"

import { Fragment, useState, type DragEvent, type ReactNode } from "react"
import { prepareVisualBuilderVideoUpload } from "@/app/[workspaceSlug]/onboarding-builder/visual-actions"
import { OnboardingLayout } from "@/components/onboarding/OnboardingLayout"
import { StripePaymentButtonLabel } from "@/components/onboarding/StripePaymentButtonLabel"
import { OnboardingSessionRenderer } from "@/components/onboarding/OnboardingSessionRenderer"
import { OnboardingThemeProvider } from "@/components/onboarding/OnboardingThemeProvider"
import { WhyWeAskCard } from "@/components/onboarding/WhyWeAskCard"
import type {
    FormBlock,
    HeaderBlock,
    OnboardingBlock,
    OnboardingBookendDefinitionV2,
    OnboardingModuleDefinitionV2,
    OnboardingPaymentDefinitionV2,
    OnboardingStepV2,
    VideoBlock,
} from "@/lib/onboarding/block-definition"
import { ONBOARDING_PAYMENT_BUTTON_ID, stepEstimate } from "@/lib/onboarding/block-definition"
import { onboardingBlockLayoutClasses } from "@/lib/onboarding/block-layout"
import type { OnboardingHelpSettings, OnboardingThemeDefinition } from "@/lib/onboarding/configuration-types"
import { getFileAcceptValue } from "@/lib/onboarding/forms"
import { APPOINTMENT_FIELD_OPTIONS, APPOINTMENT_MEDIUM_OPTIONS } from "@/lib/appointment-setting"

type DefinitionTarget = { kind: "module"; definition: OnboardingModuleDefinitionV2 } | { kind: "bookend"; definition: OnboardingBookendDefinitionV2 | OnboardingPaymentDefinitionV2 } | { kind: "payment"; definition: OnboardingPaymentDefinitionV2 }

function duplicateModifier(event: { metaKey: boolean; ctrlKey: boolean }) {
    return event.metaKey || event.ctrlKey
}

function AuthorFrame({ block, selected, collaboratorColours, select, children, onDragStart, onDrop, suppressHover = false, fixed = false }: {
    block: OnboardingBlock
    selected: boolean
    collaboratorColours?: string[]
    select: () => void
    children: ReactNode
    onDragStart: (event: DragEvent<HTMLDivElement>) => void
    onDrop: (event: DragEvent<HTMLDivElement>) => void
    suppressHover?: boolean
    fixed?: boolean
}) {
    return <div
        data-builder-block={block.id}
        draggable={block.kind !== "header" && !fixed}
        onDragStart={onDragStart}
        onDragOver={(event) => event.preventDefault()}
        onDrop={onDrop}
        onClick={(event) => { event.stopPropagation(); select() }}
        className={`group relative ${onboardingBlockLayoutClasses(block.layout)} rounded-2xl outline-offset-4 transition ${selected ? "outline-2 outline-[var(--onboarding-accent)]" : suppressHover ? "outline-transparent" : "outline-transparent hover:outline hover:outline-1 hover:outline-black/15"}`}
        style={collaboratorColours?.length ? { boxShadow: `0 0 0 3px ${collaboratorColours[0]}` } : undefined}
    >
        {block.kind !== "header" && !fixed ? <button type="button" aria-label="Drag block" className={`absolute -left-10 top-1 hidden h-8 w-8 cursor-grab items-center justify-center rounded-lg border border-black/10 bg-white text-slate-500 shadow-sm md:group-hover:flex ${selected ? "md:flex" : ""}`}>⠿</button> : null}
        {children}
    </div>
}

function InlineText({ value, update, className = "", multiline = false, placeholder }: { value: string; update: (value: string) => void; className?: string; multiline?: boolean; placeholder?: string }) {
    return multiline
        ? <textarea value={value} onChange={(event) => update(event.target.value)} rows={Math.max(2, value.split("\n").length)} placeholder={placeholder} className={`${className} block w-full resize-none border-0 bg-transparent p-0 outline-none placeholder:text-current placeholder:opacity-40`} />
        : <input value={value} onChange={(event) => update(event.target.value)} placeholder={placeholder} className={`${className} block w-full border-0 bg-transparent p-0 outline-none placeholder:text-current placeholder:opacity-40`} />
}

function FormPreview({ block, update, selectedFieldId, selectField, collaboratorColoursForField }: { block: FormBlock; update: (block: FormBlock) => void; selectedFieldId: string | null; selectField: (fieldId: string) => void; collaboratorColoursForField: (fieldId: string) => string[] }) {
    function updateField(fieldId: string, values: Partial<FormBlock["fields"][number]>) {
        update({ ...block, fields: block.fields.map((field) => field.id === fieldId ? { ...field, ...values } : field) })
    }

    function dropField(event: DragEvent<HTMLDivElement>, targetId: string) {
        const sourceId = event.dataTransfer.getData("application/x-betelgeze-field")
        if (!sourceId || sourceId === targetId) return
        event.preventDefault()
        event.stopPropagation()
        const sourceIndex = block.fields.findIndex((field) => field.id === sourceId)
        const destination = block.fields.findIndex((field) => field.id === targetId)
        if (sourceIndex < 0 || destination < 0) return
        const fields = [...block.fields]
        const [field] = fields.splice(sourceIndex, 1)
        fields.splice(destination, 0, field)
        update({ ...block, fields })
        selectField(field.id)
    }

    return <div className="space-y-6">
        {block.fields.map((field) => <div key={field.id} data-builder-field={field.id} draggable onDragStart={(event) => { event.stopPropagation(); event.dataTransfer.setData("application/x-betelgeze-field", field.id); event.dataTransfer.effectAllowed = "move" }} onDragOver={(event) => event.preventDefault()} onDrop={(event) => dropField(event, field.id)} onClick={(event) => { event.stopPropagation(); selectField(field.id) }} className={`group/field cursor-grab rounded-xl p-2 outline-offset-2 transition ${selectedFieldId === field.id ? "outline-2 outline-[var(--onboarding-accent)]" : "hover:outline hover:outline-1 hover:outline-black/10 focus-within:outline focus-within:outline-1 focus-within:outline-black/10"}`} style={collaboratorColoursForField(field.id).length ? { boxShadow: `0 0 0 3px ${collaboratorColoursForField(field.id)[0]}` } : undefined}>
            <InlineText value={field.label} update={(label) => updateField(field.id, { label })} className="text-base font-semibold text-[var(--onboarding-text)]" />
            {field.required ? <span className="text-xs text-red-500">Required</span> : null}
            <InlineText value={field.helpText} update={(helpText) => updateField(field.id, { helpText })} className="mt-1 text-sm text-[var(--onboarding-muted)]" multiline placeholder="Add help text…" />
            {field.type === "textarea" ? <textarea disabled placeholder={field.placeholder} className="mt-3 min-h-32 w-full rounded-2xl border border-black/20 bg-[var(--onboarding-surface)] px-4 py-3" /> : field.type === "file" ? <div className="mt-3 rounded-2xl border border-dashed border-black/20 bg-[var(--onboarding-page)] p-5 text-center text-sm text-[var(--onboarding-muted)]">Choose {field.multiple ? "files" : "a file"}<p className="mt-1 text-xs">{getFileAcceptValue(field.accept) ?? "Any file"} · up to 500 MB</p></div> : <input disabled type={field.type} placeholder={field.placeholder} className="mt-3 w-full rounded-2xl border border-black/20 bg-[var(--onboarding-surface)] px-4 py-3" />}
        </div>)}
        {block.whyWeAsk ? <WhyWeAskCard>{block.whyWeAsk}</WhyWeAskCard> : null}
    </div>
}

function AppointmentSetupPreview({ block, update }: { block: Extract<OnboardingBlock, { kind: "appointment_medium" | "appointment_fields" }>; update: (block: OnboardingBlock) => void }) {
    const options = block.kind === "appointment_medium"
        ? APPOINTMENT_MEDIUM_OPTIONS.filter((option) => block.options.includes(option.key))
        : APPOINTMENT_FIELD_OPTIONS.filter((option) => block.options.includes(option.key))
    return <div className="rounded-2xl border border-black/10 bg-[var(--onboarding-page)] p-5">
        <InlineText value={block.title} update={(title) => update({ ...block, title })} className="font-semibold text-[var(--onboarding-text)]" />
        <InlineText value={block.description} update={(description) => update({ ...block, description })} multiline className="mt-2 text-sm leading-6 text-[var(--onboarding-muted)]" />
        <div className="mt-4 grid gap-2 sm:grid-cols-2">{options.map((option, index) => <div key={option.key} className="flex min-h-12 items-center gap-3 rounded-xl border border-black/10 bg-[var(--onboarding-surface)] px-4 py-3 text-sm text-[var(--onboarding-text)]"><span className="inline-flex h-5 w-5 items-center justify-center rounded border border-black/20 text-xs">{block.kind === "appointment_medium" ? index === 0 ? "✓" : "" : index === 0 ? "!" : "—"}</span><span>{option.label}</span>{block.kind === "appointment_fields" ? <span className="ml-auto text-xs text-[var(--onboarding-muted)]">{index === 0 ? "Required" : "Optional"}</span> : null}</div>)}</div>
        <p className="mt-3 text-xs text-[var(--onboarding-muted)]">{block.kind === "appointment_medium" ? "Clients can select one or more." : `Name, date, and time are always included · up to ${block.maximumFields} extras`}</p>
    </div>
}

export function VisualBuilderCanvas({
    workspaceSlug,
    workspaceName,
    groupKey,
    target,
    step,
    roadmapSteps,
    moduleTitles,
    theme,
    help,
    selectedBlockId,
    selectedFieldId,
    selectBlock,
    selectField,
    helpSelected,
    selectHelp,
    selectRoadmapStep,
    updateStep,
    updateDraftRevisionId,
    viewport,
    readOnly = false,
    fullScreen = false,
    collaboratorSelections = [],
}: {
    workspaceSlug: string
    workspaceName: string
    groupKey: string
    target: DefinitionTarget
    step: OnboardingStepV2
    roadmapSteps: { key: string; title: string; complete: boolean; current: boolean; href: null }[]
    moduleTitles: string[]
    theme: OnboardingThemeDefinition
    help: OnboardingHelpSettings
    selectedBlockId: string | null
    selectedFieldId: string | null
    selectBlock: (id: string | null) => void
    selectField: (blockId: string, fieldId: string) => void
    helpSelected: boolean
    selectHelp: () => void
    selectRoadmapStep: (key: string) => void
    updateStep: (step: OnboardingStepV2) => void
    updateDraftRevisionId: (revisionId: string) => void
    viewport: "desktop" | "mobile"
    readOnly?: boolean
    fullScreen?: boolean
    collaboratorSelections?: Array<{ selection: string | null; color: string }>
}) {
    const [uploadingId, setUploadingId] = useState<string | null>(null)
    const [uploadError, setUploadError] = useState<string | null>(null)

    function replaceBlock(next: OnboardingBlock) {
        updateStep({ ...step, blocks: step.blocks.map((block) => block.id === next.id ? next : block) })
    }

    function dropBlock(event: DragEvent<HTMLDivElement>, targetId: string) {
        const sourceId = event.dataTransfer.getData("application/x-betelgeze-block")
        if (!sourceId || sourceId === targetId) return
        event.stopPropagation()
        const sourceIndex = step.blocks.findIndex((block) => block.id === sourceId)
        const targetIndex = step.blocks.findIndex((block) => block.id === targetId)
        if (sourceIndex <= 0 || targetIndex <= 0 || sourceId === ONBOARDING_PAYMENT_BUTTON_ID || targetId === ONBOARDING_PAYMENT_BUTTON_ID) return
        const copy = duplicateModifier(event)
        if (step.blocks[sourceIndex]?.kind === "estimate" && copy) return
        const blocks = [...step.blocks]
        const [source] = blocks.splice(sourceIndex, 1)
        const next = copy ? { ...source, id: crypto.randomUUID() } : source
        if (copy) blocks.splice(sourceIndex, 0, source)
        blocks.splice(targetIndex, 0, next)
        updateStep({ ...step, blocks })
        selectBlock(next.id)
    }

    async function uploadVideo(block: VideoBlock, file: File) {
        setUploadingId(block.id); setUploadError(null)
        try {
            const preparation = await prepareVisualBuilderVideoUpload(workspaceSlug, target, { name: file.name, size: file.size, type: file.type })
            if (!preparation.ok) throw new Error(preparation.error)
            if (!preparation.data) throw new Error("Betelgeze prepared the upload without returning its storage details. Try again.")
            const prepared = preparation.data
            const response = await fetch(prepared.uploadUrl, { method: "PUT", headers: { "Content-Type": file.type }, body: file })
            if (!response.ok) throw new Error(`Video storage rejected the upload (HTTP ${response.status}). Try again; if it continues, check the R2 CORS configuration.`)
            updateDraftRevisionId(prepared.draftRevisionId)
            replaceBlock({ ...block, legacyEmbedUrl: null, upload: { ...prepared.storedVideo, resolvedUrl: prepared.previewUrl } })
        } catch (error) { setUploadError(error instanceof TypeError && error.message === "Failed to fetch" ? "The browser could not reach video storage. Check the R2 CORS configuration, then try again." : error instanceof Error ? error.message : "Video upload failed.") }
        finally { setUploadingId(null) }
    }

    const header = step.blocks[0] as HeaderBlock
    const collaboratorColoursFor = (blockId: string) => collaboratorSelections.filter((presence) => presence.selection === `${groupKey}:${step.id}:${blockId}`).map((presence) => presence.color)
    const collaboratorColoursForField = (blockId: string, fieldId: string) => collaboratorSelections.filter((presence) => presence.selection === `${groupKey}:${step.id}:${blockId}:${fieldId}`).map((presence) => presence.color)
    const sectionTitle = target.kind === "module" ? target.definition.name : target.kind === "payment" || !("kind" in target.definition) ? "Payment" : target.definition.kind

    if (readOnly) {
        const hasForm = step.blocks.some((block) => block.kind === "form")
        const frameClassName = fullScreen
            ? `relative mx-auto h-dvh w-full overflow-hidden ${viewport === "mobile" ? "max-w-[430px]" : "max-w-none"}`
            : `mx-auto h-full transition-[max-width] duration-200 ${viewport === "mobile" ? "max-w-[430px]" : "max-w-[1180px]"}`
        return <div className={frameClassName}>
            <OnboardingThemeProvider theme={theme} className="h-full">
                <OnboardingLayout embedded={!fullScreen} forceMobile={viewport === "mobile"} roadmapSteps={roadmapSteps} client={{ name: "Preview client", email: null, phone: null, isTest: true }} workspaceName={workspaceName} help={help} footerText="Preview · nothing is saved" onRoadmapSelect={selectRoadmapStep}>
                    <OnboardingSessionRenderer
                        step={{ key: step.id, kind: "video", title: header.title, description: header.description, moduleTitle: sectionTitle, estimatedTime: stepEstimate(step)?.estimatedTime ?? header.estimatedTime, why: "", blocks: step.blocks, navigation: step.navigation }}
                        moduleTitles={moduleTitles}
                        showModuleSummary
                        preview
                        previewNextHref="#"
                        backHref="#"
                        forceMobile={viewport === "mobile"}
                        onPreviewSubmit={() => undefined}
                        action={!hasForm ? <button type="button" className="block w-full rounded-xl bg-[var(--onboarding-primary)] px-5 py-4 text-center font-medium text-white">{step.navigation.continueLabel}</button> : null}
                    />
                </OnboardingLayout>
            </OnboardingThemeProvider>
        </div>
    }

    return <div className={`mx-auto h-full transition-[max-width] duration-200 ${viewport === "mobile" ? "max-w-[430px]" : "max-w-[1180px]"}`}>
        <OnboardingThemeProvider theme={theme} className="h-full">
            <OnboardingLayout embedded forceMobile={viewport === "mobile"} roadmapSteps={roadmapSteps} client={{ name: "Preview client", email: null, phone: null, isTest: true }} workspaceName={workspaceName} help={help} helpSelected={helpSelected} onHelpSelect={selectHelp} footerText="Builder preview · changes are drafts" onRoadmapSelect={selectRoadmapStep} headerActions={<span className="rounded-full border border-black/10 bg-black/5 px-3 py-1 text-xs font-medium">Draft</span>}>
                <div className={`rounded-2xl border border-black/10 bg-[var(--onboarding-surface)] p-6 shadow-sm ${viewport === "mobile" ? "" : "sm:p-8"}`} onClick={() => selectBlock(null)}>
                    <AuthorFrame block={header} selected={selectedBlockId === header.id} collaboratorColours={collaboratorColoursFor(header.id)} select={() => selectBlock(header.id)} onDragStart={() => undefined} onDrop={() => undefined}>
                        <p className="text-sm font-semibold uppercase tracking-wide text-[var(--onboarding-primary)]">{sectionTitle}</p>
                        <InlineText value={header.title} update={(title) => replaceBlock({ ...header, title })} className="mt-3 text-3xl font-semibold tracking-tight text-[var(--onboarding-text)]" placeholder="Untitled step" />
                        <InlineText value={header.description} update={(description) => replaceBlock({ ...header, description })} className="mt-4 text-lg leading-7 text-[var(--onboarding-muted)]" multiline placeholder="Add a description…" />
                    </AuthorFrame>
                    {step.blocks.slice(1).map((block) => <Fragment key={block.id}><AuthorFrame block={block} fixed={block.id === ONBOARDING_PAYMENT_BUTTON_ID} selected={selectedBlockId === block.id && !selectedFieldId} suppressHover={block.kind === "form"} collaboratorColours={collaboratorColoursFor(block.id)} select={() => selectBlock(block.id)} onDragStart={(event) => { const copy = duplicateModifier(event); event.dataTransfer.setData("application/x-betelgeze-block", block.id); event.dataTransfer.setData("application/x-betelgeze-builder-item", JSON.stringify({ type: "block", groupKey, stepId: step.id, blockId: block.id, copy })); event.dataTransfer.effectAllowed = copy ? "copy" : "move" }} onDrop={(event) => dropBlock(event, block.id)}>
                        {block.kind === "estimate" ? <div className="inline-flex rounded-full bg-[color-mix(in_srgb,var(--onboarding-accent)_14%,var(--onboarding-surface))] px-3 py-1 text-sm font-medium text-[var(--onboarding-primary)]">Estimated time: <InlineText value={block.estimatedTime} update={(estimatedTime) => replaceBlock({ ...block, estimatedTime })} className="ml-1 w-auto min-w-20 text-sm font-medium text-[var(--onboarding-primary)]" placeholder="2–3 minutes" /></div> : block.kind === "checklist" ? <div className="rounded-2xl bg-[var(--onboarding-page)] p-5"><InlineText value={block.title} update={(title) => replaceBlock({ ...block, title })} className="font-semibold text-[var(--onboarding-text)]" /> <ul className="mt-4 space-y-2 text-sm leading-6">{(block.source === "modules" ? moduleTitles : block.items).map((item, index) => <li key={index} className="flex gap-2"><span className="font-semibold text-[var(--onboarding-primary)]">✓</span>{block.source === "modules" ? <span>{item}</span> : <InlineText value={item} update={(value) => replaceBlock({ ...block, items: block.items.map((current, itemIndex) => itemIndex === index ? value : current) })} className="min-w-0 flex-1" />}</li>)}</ul>{block.footer ? <InlineText value={block.footer} update={(footer) => replaceBlock({ ...block, footer })} multiline className="mt-4 text-sm leading-6 text-[var(--onboarding-muted)]" /> : null}</div> : block.kind === "form" ? <FormPreview block={block} update={replaceBlock} selectedFieldId={selectedFieldId} selectField={(fieldId) => selectField(block.id, fieldId)} collaboratorColoursForField={(fieldId) => collaboratorColoursForField(block.id, fieldId)} /> : block.kind === "appointment_medium" || block.kind === "appointment_fields" ? <AppointmentSetupPreview block={block} update={replaceBlock} /> : block.kind === "video" ? <div>{block.upload?.resolvedUrl || block.upload?.path ? <video src={block.upload?.resolvedUrl ?? block.upload?.path} controls className="aspect-video w-full rounded-2xl bg-black" /> : <div className="aspect-video rounded-2xl border border-dashed border-black/20 bg-[var(--onboarding-page)] p-8 text-center text-sm text-[var(--onboarding-muted)]">Upload a video to show it here.</div>}{selectedBlockId === block.id ? <label className="mt-3 inline-flex cursor-pointer rounded-lg border border-black/15 bg-white px-3 py-2 text-xs font-medium text-slate-700 shadow-sm">{uploadingId === block.id ? "Uploading…" : block.upload ? "Replace video" : "Upload video"}<input type="file" accept="video/*" disabled={uploadingId === block.id} onChange={(event) => { const file = event.target.files?.[0]; if (file) void uploadVideo(block, file) }} className="sr-only" /></label> : null}{block.legacyEmbedUrl ? <p className="mt-2 text-xs text-red-700">Replace this legacy embed with an upload before publishing.</p> : null}</div> : block.kind === "connection" ? <div className="rounded-2xl border border-black/10 bg-[var(--onboarding-page)] p-5"><p className="font-semibold text-[var(--onboarding-text)]">Facebook Ads</p><InlineText value={block.description} update={(description) => replaceBlock({ ...block, description })} multiline className="mt-2 text-sm leading-6 text-[var(--onboarding-muted)]" /><div className="mt-4 inline-flex min-h-12 items-center justify-center rounded-xl bg-[var(--onboarding-primary)] px-5 py-3 font-medium text-white"><InlineText value={block.label} update={(label) => replaceBlock({ ...block, label })} /></div></div> : block.kind === "button" ? block.id === ONBOARDING_PAYMENT_BUTTON_ID ? <div className="inline-flex min-h-12 items-center justify-center rounded-xl bg-[#635bff] px-5 py-3 font-medium text-white shadow-sm"><StripePaymentButtonLabel /></div> : <InlineText value={block.label} update={(label) => replaceBlock({ ...block, label })} className={`${block.appearance === "secondary" ? "border border-[var(--onboarding-primary)] text-[var(--onboarding-primary)]" : "bg-[var(--onboarding-primary)] text-white"} inline-flex min-h-12 w-auto rounded-xl px-5 py-3 font-medium`} /> : null}
                    </AuthorFrame></Fragment>)}
                    {uploadError ? <p role="alert" className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">{uploadError}</p> : null}
                    <div className="mt-8 flex items-stretch gap-3"><div className="inline-flex min-h-14 min-w-24 items-center rounded-xl border border-[var(--onboarding-primary)] px-5 font-medium text-[var(--onboarding-primary)]"><InlineText value={step.navigation.backLabel} update={(backLabel) => updateStep({ ...step, navigation: { ...step.navigation, backLabel } })} className="text-center" /></div><div className="inline-flex min-h-14 flex-1 items-center rounded-xl bg-[var(--onboarding-primary)] px-5 py-4 font-medium text-white"><InlineText value={step.navigation.continueLabel} update={(continueLabel) => updateStep({ ...step, navigation: { ...step.navigation, continueLabel } })} className="text-center" /></div></div>
                </div>
            </OnboardingLayout>
        </OnboardingThemeProvider>
    </div>
}
