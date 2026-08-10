"use client"

import { Fragment, useState, type DragEvent, type ReactNode } from "react"
import { prepareVisualBuilderVideoUpload } from "@/app/[workspaceSlug]/onboarding-builder/visual-actions"
import { OnboardingLayout } from "@/components/onboarding/OnboardingLayout"
import { OnboardingSessionRenderer } from "@/components/onboarding/OnboardingSessionRenderer"
import { OnboardingThemeProvider } from "@/components/onboarding/OnboardingThemeProvider"
import { WhyWeAskCard } from "@/components/onboarding/WhyWeAskCard"
import type {
    FormBlock,
    HeaderBlock,
    OnboardingBlock,
    OnboardingBookendDefinitionV2,
    OnboardingModuleDefinitionV2,
    OnboardingStepV2,
    VideoBlock,
} from "@/lib/onboarding/block-definition"
import { createButtonBlock, createFormBlock, createVideoBlock } from "@/lib/onboarding/block-definition"
import { onboardingBlockLayoutClasses } from "@/lib/onboarding/block-layout"
import type { OnboardingHelpSettings, OnboardingThemeDefinition } from "@/lib/onboarding/configuration-types"
import { getFileAcceptValue } from "@/lib/onboarding/forms"
import { visualStepTitle } from "@/lib/onboarding/block-validation"

type DefinitionTarget = { kind: "module"; definition: OnboardingModuleDefinitionV2 } | { kind: "bookend"; definition: OnboardingBookendDefinitionV2 }

function AuthorFrame({ block, selected, collaboratorColours, select, children, onDragStart, onDrop }: {
    block: OnboardingBlock
    selected: boolean
    collaboratorColours?: string[]
    select: () => void
    children: ReactNode
    onDragStart: (event: DragEvent<HTMLDivElement>) => void
    onDrop: (event: DragEvent<HTMLDivElement>) => void
}) {
    return <div
        data-builder-block={block.id}
        draggable={block.kind !== "header"}
        onDragStart={onDragStart}
        onDragOver={(event) => event.preventDefault()}
        onDrop={onDrop}
        onClick={(event) => { event.stopPropagation(); select() }}
        className={`group relative ${onboardingBlockLayoutClasses(block.layout)} rounded-2xl outline-offset-4 transition ${selected ? "outline-2 outline-[var(--onboarding-accent)]" : "outline-transparent hover:outline hover:outline-1 hover:outline-black/15"}`}
        style={collaboratorColours?.length ? { boxShadow: `0 0 0 3px ${collaboratorColours[0]}` } : undefined}
    >
        {block.kind !== "header" ? <button type="button" aria-label="Drag block" className={`absolute -left-10 top-1 hidden h-8 w-8 cursor-grab items-center justify-center rounded-lg border border-black/10 bg-white text-slate-500 shadow-sm md:group-hover:flex ${selected ? "md:flex" : ""}`}>⠿</button> : null}
        {children}
    </div>
}

function InlineText({ value, update, className, multiline = false, placeholder }: { value: string; update: (value: string) => void; className: string; multiline?: boolean; placeholder?: string }) {
    return multiline
        ? <textarea value={value} onChange={(event) => update(event.target.value)} rows={Math.max(2, value.split("\n").length)} placeholder={placeholder} className={`${className} block w-full resize-none border-0 bg-transparent p-0 outline-none placeholder:text-current placeholder:opacity-40`} />
        : <input value={value} onChange={(event) => update(event.target.value)} placeholder={placeholder} className={`${className} block w-full border-0 bg-transparent p-0 outline-none placeholder:text-current placeholder:opacity-40`} />
}

function FormPreview({ block, update }: { block: FormBlock; update: (block: FormBlock) => void }) {
    function updateField(fieldId: string, values: Partial<FormBlock["fields"][number]>) {
        update({ ...block, fields: block.fields.map((field) => field.id === fieldId ? { ...field, ...values } : field) })
    }

    function moveField(index: number, direction: -1 | 1) {
        const destination = index + direction
        if (destination < 0 || destination >= block.fields.length) return
        const fields = [...block.fields]
        const [field] = fields.splice(index, 1)
        fields.splice(destination, 0, field)
        update({ ...block, fields })
    }

    return <div className="space-y-6">
        {block.fields.map((field, index) => <div key={field.id} className="group/field rounded-xl p-1 outline-offset-2 hover:outline hover:outline-1 hover:outline-black/10 focus-within:outline focus-within:outline-1 focus-within:outline-black/10">
            <div className="flex items-center gap-2"><InlineText value={field.label} update={(label) => updateField(field.id, { label })} className="text-base font-semibold text-[var(--onboarding-text)]" /><div className="hidden shrink-0 items-center gap-1 md:group-hover/field:flex md:group-focus-within/field:flex"><button type="button" aria-label="Move field up" disabled={index === 0} onClick={() => moveField(index, -1)} className="rounded px-1 text-xs text-slate-500 disabled:opacity-20">↑</button><button type="button" aria-label="Move field down" disabled={index === block.fields.length - 1} onClick={() => moveField(index, 1)} className="rounded px-1 text-xs text-slate-500 disabled:opacity-20">↓</button><button type="button" onClick={() => update({ ...block, fields: block.fields.filter((item) => item.id !== field.id) })} className="text-xs text-red-600">Delete</button></div></div>
            {field.required ? <span className="text-xs text-red-500">Required</span> : null}
            <InlineText value={field.helpText} update={(helpText) => updateField(field.id, { helpText })} className="mt-1 text-sm text-[var(--onboarding-muted)]" multiline placeholder="Add help text…" />
            {field.type === "textarea" ? <textarea disabled placeholder={field.placeholder} className="mt-3 min-h-32 w-full rounded-2xl border border-black/20 bg-[var(--onboarding-surface)] px-4 py-3" /> : field.type === "file" ? <div className="mt-3 rounded-2xl border border-dashed border-black/20 bg-[var(--onboarding-page)] p-5 text-center text-sm text-[var(--onboarding-muted)]">Choose {field.multiple ? "files" : "a file"}<p className="mt-1 text-xs">{getFileAcceptValue(field.accept) ?? "Any file"} · up to 500 MB</p></div> : <input disabled type={field.type} placeholder={field.placeholder} className="mt-3 w-full rounded-2xl border border-black/20 bg-[var(--onboarding-surface)] px-4 py-3" />}
            <div className="mt-2 hidden grid-cols-2 gap-2 rounded-xl bg-black/5 p-2 group-hover/field:grid group-focus-within/field:grid"><select aria-label="Field type" value={field.type} onChange={(event) => updateField(field.id, { type: event.target.value as typeof field.type, multiple: event.target.value === "file" ? field.multiple : false })} className="h-8 rounded-lg border border-black/15 bg-white px-2 text-xs text-slate-800"><option value="text">Short text</option><option value="email">Email</option><option value="tel">Phone</option><option value="url">URL</option><option value="textarea">Long text</option><option value="file">File</option></select><label className="flex items-center gap-2 text-xs text-slate-600"><input type="checkbox" checked={field.required} onChange={(event) => updateField(field.id, { required: event.target.checked })} />Required</label><input value={field.placeholder} onChange={(event) => updateField(field.id, { placeholder: event.target.value })} placeholder="Placeholder" className="col-span-2 h-8 rounded-lg border border-black/15 bg-white px-2 text-xs text-slate-800" />{field.type === "file" ? <><select aria-label="Accepted file type" value={field.accept} onChange={(event) => updateField(field.id, { accept: event.target.value as typeof field.accept })} className="h-8 rounded-lg border border-black/15 bg-white px-2 text-xs text-slate-800"><option value="any">Any file</option><option value="image">Images</option><option value="video">Videos</option><option value="document">Documents</option></select><label className="flex items-center gap-2 text-xs text-slate-600"><input type="checkbox" checked={field.multiple} onChange={(event) => updateField(field.id, { multiple: event.target.checked })} />Multiple</label></> : null}</div>
        </div>)}
        {block.whyWeAsk ? <WhyWeAskCard>{block.whyWeAsk}</WhyWeAskCard> : null}
    </div>
}

export function VisualBuilderCanvas({
    workspaceSlug,
    workspaceName,
    groupKey,
    target,
    step,
    steps,
    moduleTitles,
    theme,
    help,
    selectedBlockId,
    selectBlock,
    selectStep,
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
    steps: OnboardingStepV2[]
    moduleTitles: string[]
    theme: OnboardingThemeDefinition
    help: OnboardingHelpSettings
    selectedBlockId: string | null
    selectBlock: (id: string | null) => void
    selectStep: (id: string) => void
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
        if (sourceIndex <= 0 || targetIndex <= 0) return
        const blocks = [...step.blocks]
        const [source] = blocks.splice(sourceIndex, 1)
        const next = event.shiftKey ? { ...source, id: crypto.randomUUID() } : source
        if (event.shiftKey) blocks.splice(sourceIndex, 0, source)
        blocks.splice(targetIndex, 0, next)
        updateStep({ ...step, blocks })
        selectBlock(next.id)
    }

    function insertBlock(index: number, kind: "form" | "video" | "button") {
        if (kind === "form" && (target.kind === "bookend" || step.blocks.some((block) => block.kind === "form"))) return
        const block = kind === "form" ? createFormBlock() : kind === "video" ? createVideoBlock() : createButtonBlock()
        const blocks = [...step.blocks]
        blocks.splice(index, 0, block)
        updateStep({ ...step, blocks })
        selectBlock(block.id)
    }

    async function uploadVideo(block: VideoBlock, file: File) {
        setUploadingId(block.id); setUploadError(null)
        try {
            const prepared = await prepareVisualBuilderVideoUpload(workspaceSlug, target, { name: file.name, size: file.size, type: file.type })
            const response = await fetch(prepared.uploadUrl, { method: "PUT", headers: { "Content-Type": file.type }, body: file })
            if (!response.ok) throw new Error(`Upload failed with status ${response.status}.`)
            updateDraftRevisionId(prepared.draftRevisionId)
            replaceBlock({ ...block, legacyEmbedUrl: null, upload: { ...prepared.storedVideo, resolvedUrl: prepared.previewUrl } })
        } catch (error) { setUploadError(error instanceof Error ? error.message : "Video upload failed.") }
        finally { setUploadingId(null) }
    }

    const roadmap = steps.map((item) => ({ key: item.id, title: visualStepTitle(item), complete: false, current: item.id === step.id, href: null }))
    const header = step.blocks[0] as HeaderBlock
    const collaboratorColoursFor = (blockId: string) => collaboratorSelections.filter((presence) => presence.selection === `${groupKey}:${step.id}:${blockId}`).map((presence) => presence.color)

    if (readOnly) {
        const hasForm = step.blocks.some((block) => block.kind === "form")
        const frameClassName = fullScreen
            ? `relative mx-auto h-dvh w-full overflow-hidden ${viewport === "mobile" ? "max-w-[430px]" : "max-w-none"}`
            : `mx-auto h-full transition-[max-width] duration-200 ${viewport === "mobile" ? "max-w-[430px]" : "max-w-[1180px]"}`
        return <div className={frameClassName}>
            <OnboardingThemeProvider theme={theme} className="h-full">
                <OnboardingLayout embedded={!fullScreen} forceMobile={viewport === "mobile"} roadmapSteps={roadmap} client={{ name: "Preview client", email: null, phone: null, isTest: true }} workspaceName={workspaceName} help={help} footerText="Preview · nothing is saved" onRoadmapSelect={selectStep}>
                    <OnboardingSessionRenderer
                        step={{ key: step.id, kind: "video", title: header.title, description: header.description, moduleTitle: target.kind === "module" ? target.definition.name : target.definition.kind, estimatedTime: header.estimatedTime, why: "", blocks: step.blocks, navigation: step.navigation }}
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
            <OnboardingLayout embedded forceMobile={viewport === "mobile"} roadmapSteps={roadmap} client={{ name: "Preview client", email: null, phone: null, isTest: true }} workspaceName={workspaceName} help={help} footerText="Builder preview · changes are drafts" onRoadmapSelect={selectStep} headerActions={<span className="rounded-full border border-black/10 bg-black/5 px-3 py-1 text-xs font-medium">Draft</span>}>
                <div className={`rounded-2xl border border-black/10 bg-[var(--onboarding-surface)] p-6 shadow-sm ${viewport === "mobile" ? "" : "sm:p-8"}`} onClick={() => selectBlock(null)}>
                    <p className="text-sm font-semibold uppercase tracking-wide text-[var(--onboarding-primary)]">{target.kind === "module" ? target.definition.name : target.definition.kind}</p>
                    <AuthorFrame block={header} selected={selectedBlockId === header.id} collaboratorColours={collaboratorColoursFor(header.id)} select={() => selectBlock(header.id)} onDragStart={() => undefined} onDrop={() => undefined}>
                        <InlineText value={header.title} update={(title) => replaceBlock({ ...header, title })} className="text-3xl font-semibold tracking-tight text-[var(--onboarding-text)]" placeholder="Untitled step" />
                        <InlineText value={header.description} update={(description) => replaceBlock({ ...header, description })} className="mt-4 text-lg leading-7 text-[var(--onboarding-muted)]" multiline placeholder="Add a description…" />
                        <InlineText value={header.estimatedTime} update={(estimatedTime) => replaceBlock({ ...header, estimatedTime })} className="mt-5 inline-flex w-auto rounded-full bg-[color-mix(in_srgb,var(--onboarding-accent)_14%,var(--onboarding-surface))] px-3 py-1 text-sm font-medium text-[var(--onboarding-primary)]" placeholder="Estimated time" />
                        {header.showComposedModuleSummary ? <div className="mt-8 rounded-2xl bg-[var(--onboarding-page)] p-5"><p className="font-semibold">Your onboarding includes:</p><div className="mt-4 flex flex-wrap gap-2">{moduleTitles.map((title) => <span key={title} className="rounded-full bg-black/5 px-3 py-1 text-sm font-medium text-[var(--onboarding-primary)]">✓ {title}</span>)}</div></div> : null}
                    </AuthorFrame>
                    {step.blocks.slice(1).map((block, blockIndex) => <Fragment key={block.id}><details className="group/insert relative mx-auto mt-3 hidden w-fit md:block"><summary aria-label="Insert a block here" className="flex h-7 w-7 cursor-pointer list-none items-center justify-center rounded-full border border-black/15 bg-white text-sm text-slate-500 opacity-0 shadow-sm transition hover:text-slate-900 group-hover/insert:opacity-100 focus:opacity-100">+</summary><div className="absolute left-1/2 z-20 mt-1 flex -translate-x-1/2 gap-1 rounded-xl border border-black/10 bg-white p-1 shadow-xl"><button type="button" disabled={target.kind === "bookend" || step.blocks.some((candidate) => candidate.kind === "form")} onClick={() => insertBlock(blockIndex + 1, "form")} className="rounded-lg px-2 py-1 text-xs text-slate-700 hover:bg-slate-100 disabled:opacity-30">Form</button><button type="button" onClick={() => insertBlock(blockIndex + 1, "video")} className="rounded-lg px-2 py-1 text-xs text-slate-700 hover:bg-slate-100">Video</button><button type="button" onClick={() => insertBlock(blockIndex + 1, "button")} className="rounded-lg px-2 py-1 text-xs text-slate-700 hover:bg-slate-100">Button</button></div></details><AuthorFrame block={block} selected={selectedBlockId === block.id} collaboratorColours={collaboratorColoursFor(block.id)} select={() => selectBlock(block.id)} onDragStart={(event) => { event.dataTransfer.setData("application/x-betelgeze-block", block.id); event.dataTransfer.setData("application/x-betelgeze-builder-item", JSON.stringify({ type: "block", groupKey, stepId: step.id, blockId: block.id, copy: event.shiftKey })); event.dataTransfer.effectAllowed = event.shiftKey ? "copy" : "move" }} onDrop={(event) => dropBlock(event, block.id)}>
                        {block.kind === "form" ? <FormPreview block={block} update={replaceBlock} /> : block.kind === "video" ? <div>{block.upload?.resolvedUrl || block.upload?.path ? <video src={block.upload?.resolvedUrl ?? block.upload?.path} controls className="aspect-video w-full rounded-2xl bg-black" /> : <div className="aspect-video rounded-2xl border border-dashed border-black/20 bg-[var(--onboarding-page)] p-8 text-center text-sm text-[var(--onboarding-muted)]">Upload a video to show it here.</div>}{selectedBlockId === block.id ? <label className="mt-3 inline-flex cursor-pointer rounded-lg border border-black/15 bg-white px-3 py-2 text-xs font-medium text-slate-700 shadow-sm">{uploadingId === block.id ? "Uploading…" : block.upload ? "Replace video" : "Upload video"}<input type="file" accept="video/*" disabled={uploadingId === block.id} onChange={(event) => { const file = event.target.files?.[0]; if (file) void uploadVideo(block, file) }} className="sr-only" /></label> : null}{block.legacyEmbedUrl ? <p className="mt-2 text-xs text-red-700">Replace this legacy embed with an upload before publishing.</p> : null}</div> : block.kind === "button" ? <div><InlineText value={block.label} update={(label) => replaceBlock({ ...block, label })} className={`${block.appearance === "secondary" ? "border border-[var(--onboarding-primary)] text-[var(--onboarding-primary)]" : "bg-[var(--onboarding-primary)] text-white"} inline-flex min-h-12 w-auto rounded-xl px-5 py-3 font-medium`} />{selectedBlockId === block.id ? <input value={block.url} onChange={(event) => replaceBlock({ ...block, url: event.target.value })} placeholder="https://…" className="mt-3 h-10 w-full rounded-lg border border-black/15 bg-white px-3 text-sm text-slate-900" /> : null}</div> : null}
                        {selectedBlockId === block.id && (block.kind === "video" || block.kind === "button") ? <label className="mt-3 flex items-center gap-2 text-xs text-[var(--onboarding-muted)]"><input type="checkbox" checked={block.kind === "video" ? block.requirement === "finish" : block.required} onChange={(event) => replaceBlock(block.kind === "video" ? { ...block, requirement: event.target.checked ? "finish" : "none" } : { ...block, required: event.target.checked })} />{block.kind === "video" ? "Client must finish this video" : "Client must open this link"}</label> : null}
                    </AuthorFrame></Fragment>)}
                    <details className="group/insert relative mx-auto mt-4 hidden w-fit md:block"><summary aria-label="Add a block" className="flex h-8 w-8 cursor-pointer list-none items-center justify-center rounded-full border border-black/15 bg-white text-sm text-slate-500 shadow-sm hover:text-slate-900">+</summary><div className="absolute bottom-10 left-1/2 z-20 flex -translate-x-1/2 gap-1 rounded-xl border border-black/10 bg-white p-1 shadow-xl"><button type="button" disabled={target.kind === "bookend" || step.blocks.some((block) => block.kind === "form")} onClick={() => insertBlock(step.blocks.length, "form")} className="rounded-lg px-2 py-1 text-xs text-slate-700 hover:bg-slate-100 disabled:opacity-30">Form</button><button type="button" onClick={() => insertBlock(step.blocks.length, "video")} className="rounded-lg px-2 py-1 text-xs text-slate-700 hover:bg-slate-100">Video</button><button type="button" onClick={() => insertBlock(step.blocks.length, "button")} className="rounded-lg px-2 py-1 text-xs text-slate-700 hover:bg-slate-100">Button</button></div></details>
                    {uploadError ? <p role="alert" className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">{uploadError}</p> : null}
                    <div className="mt-8 flex items-stretch gap-3"><div className="inline-flex min-h-14 min-w-24 items-center rounded-xl border border-[var(--onboarding-primary)] px-5 font-medium text-[var(--onboarding-primary)]"><InlineText value={step.navigation.backLabel} update={(backLabel) => updateStep({ ...step, navigation: { ...step.navigation, backLabel } })} className="text-center" /></div><div className="inline-flex min-h-14 flex-1 items-center rounded-xl bg-[var(--onboarding-primary)] px-5 py-4 font-medium text-white"><InlineText value={step.navigation.continueLabel} update={(continueLabel) => updateStep({ ...step, navigation: { ...step.navigation, continueLabel } })} className="text-center" /></div></div>
                </div>
            </OnboardingLayout>
        </OnboardingThemeProvider>
    </div>
}
