"use client"

import { useEffect, useRef, useState, useTransition, type ReactNode } from "react"
import { useRouter } from "next/navigation"
import {
    archiveOnboardingModule,
    createOnboardingModule,
    deleteOnboardingModuleDraft,
    duplicateOnboardingModule,
    prepareBuilderVideoUpload,
    publishOnboardingBookend,
    publishOnboardingModule,
    revokeOnboardingModulePreview,
    restoreOnboardingModule,
    rotateOnboardingModulePreview,
    saveOnboardingBookendDraft,
    saveOnboardingModuleDraft,
} from "@/app/[workspaceSlug]/onboarding-builder/actions"
import { SortableAuthoringList } from "@/components/onboarding-builder/SortableAuthoringList"
import { BuilderPreview } from "@/components/onboarding-builder/BuilderPreview"
import { RoundPill, SquarePill } from "@/components/ui"
import type {
    ConfiguredOnboardingField,
    ConfiguredOnboardingStep,
    OnboardingBookendDefinition,
    OnboardingBuilderData,
    OnboardingModuleDefinition,
    OnboardingModulePublishImpact,
    OnboardingModuleSummary,
} from "@/lib/onboarding/configuration-types"
import { modulePublishDiff } from "@/lib/onboarding/publish-impact"

type Selection = { type: "module" } | { type: "step"; stepId: string } | { type: "field"; stepId: string; fieldId: string }
type LibrarySelection = { type: "module"; id: string } | { type: "bookend"; kind: "welcome" | "completion" }
type SaveState = "idle" | "saving" | "saved" | "error"

function newField(): ConfiguredOnboardingField {
    const id = crypto.randomUUID()
    return { id, key: `field-${id.replaceAll("-", "").slice(-12)}`, label: "Short answer", type: "text", required: false, helpText: "", placeholder: "", accept: "any", multiple: false }
}

function newStep(kind: "form" | "video"): ConfiguredOnboardingStep {
    const id = crypto.randomUUID()
    return { id, key: `step-${id.replaceAll("-", "").slice(-12)}`, kind, title: kind === "form" ? "New form step" : "New video step", description: "", estimatedTime: kind === "form" ? "2–3 minutes" : "2 minutes", why: "", videoUrl: "", videoPath: null, fields: kind === "form" ? [newField()] : [] }
}

function actionError(outcome: { ok: boolean; error?: string }, fallback: string) {
    return outcome.ok ? null : outcome.error ?? fallback
}

function useModuleAutosave(workspaceSlug: string, currentModule: OnboardingModuleDefinition | null, enabled: boolean) {
    const [state, setState] = useState<SaveState>("idle")
    const [error, setError] = useState<string | null>(null)
    const baselines = useRef(new Map<string, string>())
    const latest = useRef(currentModule)
    const saving = useRef(false)
    const timer = useRef<number | null>(null)

    useEffect(() => {
        latest.current = currentModule
    }, [currentModule])

    useEffect(() => {
        if (!currentModule) return
        const value = JSON.stringify(currentModule)
        if (!baselines.current.has(currentModule.id)) {
            baselines.current.set(currentModule.id, value)
            return
        }
        if (!enabled || value === baselines.current.get(currentModule.id)) return
        if (timer.current) window.clearTimeout(timer.current)
        timer.current = window.setTimeout(() => {
            async function persist(initial: OnboardingModuleDefinition) {
                if (saving.current || !enabled) return
                saving.current = true
                let payload: OnboardingModuleDefinition | null = initial
                while (payload) {
                    const serialized: string = JSON.stringify(payload)
                    if (serialized === baselines.current.get(payload.id)) break
                    setState("saving")
                    setError(null)
                    const outcome = await saveOnboardingModuleDraft(workspaceSlug, payload.id, payload)
                    if (!outcome.ok) {
                        setState("error")
                        setError(outcome.error)
                        break
                    }
                    baselines.current.set(payload.id, serialized)
                    setState("saved")
                    const newest = latest.current
                    payload = newest?.id === payload.id && JSON.stringify(newest) !== serialized ? newest : null
                }
                saving.current = false
            }
            void persist(currentModule)
        }, 750)
        return () => { if (timer.current) window.clearTimeout(timer.current) }
    }, [currentModule, enabled, workspaceSlug])

    return { state, error }
}

function Pane({ title, detail, children, className = "" }: { title: string; detail?: string; children: ReactNode; className?: string }) {
    return <section className={`min-h-0 overflow-hidden rounded-2xl border border-neutral-800 bg-neutral-900 ${className}`}><header className="border-b border-neutral-800 px-3 py-3"><h2 className="text-sm font-semibold text-white">{title}</h2>{detail ? <p className="mt-1 text-xs leading-5 text-neutral-600">{detail}</p> : null}</header>{children}</section>
}

function LibraryPane({ data, selection, select, create, pending }: { data: OnboardingBuilderData; selection: LibrarySelection; select: (selection: LibrarySelection) => void; create: () => void; pending: boolean }) {
    return <Pane title="Modules and bookends" detail="Reusable workspace onboarding content." className="flex flex-col"><div className="min-h-0 flex-1 overflow-y-auto p-2"><p className="px-2 pb-1 pt-1 text-[10px] font-semibold uppercase tracking-wide text-neutral-600">Required bookends</p>{([data.welcome, data.completion] as const).map((bookend) => <button key={bookend.kind} type="button" onClick={() => select({ type: "bookend", kind: bookend.kind })} className={`mt-1 flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm ${selection.type === "bookend" && selection.kind === bookend.kind ? "bg-neutral-800 text-white" : "text-neutral-400 hover:bg-neutral-800/70 hover:text-white"}`}><span className="min-w-0 flex-1 truncate capitalize">{bookend.kind}</span><RoundPill>Locked</RoundPill></button>)}<div className="mt-3 flex items-center justify-between px-2"><p className="text-[10px] font-semibold uppercase tracking-wide text-neutral-600">Modules</p><button type="button" disabled={pending || !data.schemaReady} onClick={create} className="text-xs text-neutral-300 underline underline-offset-4 disabled:opacity-30">New module</button></div>{data.modules.map((module) => <button key={module.id} type="button" onClick={() => select({ type: "module", id: module.id })} className={`mt-1 block w-full rounded-lg px-3 py-2 text-left ${selection.type === "module" && selection.id === module.id ? "bg-neutral-800" : "hover:bg-neutral-800/70"}`}><span className="flex min-w-0 items-center gap-2"><span className="min-w-0 flex-1 truncate text-sm text-neutral-200">{module.name}</span>{module.isTest ? <SquarePill tone="yellow">Test</SquarePill> : null}</span><span className="mt-1 flex items-center gap-2 text-[11px] text-neutral-600"><span>v{module.version}</span><span>{module.stepCount} steps</span>{module.mandatory ? <span>Mandatory</span> : null}</span></button>)}</div></Pane>
}

function OutlinePane({ module, selection, setSelection, update }: { module: OnboardingModuleDefinition | null; selection: Selection; setSelection: (selection: Selection) => void; update: (module: OnboardingModuleDefinition) => void }) {
    if (!module) return <Pane title="Outline" className="flex items-center justify-center p-5"><p className="text-sm text-neutral-600">Choose a module to edit its outline.</p></Pane>
    return <Pane title="Step and field outline" detail="Drag steps and fields to set the client order." className="flex flex-col"><div className="min-h-0 flex-1 overflow-y-auto p-2"><button type="button" onClick={() => setSelection({ type: "module" })} className={`mb-2 block w-full rounded-lg px-3 py-2 text-left text-sm ${selection.type === "module" ? "bg-neutral-800 text-white" : "text-neutral-400 hover:bg-neutral-800/70"}`}>Module settings</button><SortableAuthoringList items={module.steps} onChange={(steps) => update({ ...module, steps })} ariaLabel="Module step order" renderItem={(step, index, handle) => <div className="rounded-xl border border-neutral-800 bg-black/45 p-1.5"><div className="flex items-center gap-1">{handle}<button type="button" onClick={() => setSelection({ type: "step", stepId: step.id })} className={`min-w-0 flex-1 rounded-lg px-2 py-2 text-left ${selection.type !== "module" && selection.stepId === step.id && selection.type === "step" ? "bg-neutral-800" : "hover:bg-neutral-900"}`}><span className="flex items-center gap-2"><span className="min-w-0 flex-1 truncate text-sm text-neutral-200">{index + 1}. {step.title}</span><RoundPill>{step.kind}</RoundPill></span></button></div>{step.kind === "form" ? <div className="ml-10 mt-1"><SortableAuthoringList items={step.fields} onChange={(fields) => update({ ...module, steps: module.steps.map((item) => item.id === step.id ? { ...item, fields } : item) })} ariaLabel={`${step.title} field order`} renderItem={(field, fieldIndex, fieldHandle) => <div className="flex items-center gap-1">{fieldHandle}<button type="button" onClick={() => setSelection({ type: "field", stepId: step.id, fieldId: field.id })} className={`min-w-0 flex-1 truncate rounded-lg px-2 py-1.5 text-left text-xs ${selection.type === "field" && selection.fieldId === field.id ? "bg-neutral-800 text-white" : "text-neutral-500 hover:bg-neutral-900 hover:text-neutral-200"}`}>{fieldIndex + 1}. {field.label}</button></div>} /></div> : null}</div>} /></div><div className="grid grid-cols-2 gap-2 border-t border-neutral-800 p-2"><button type="button" onClick={() => { const step = newStep("form"); update({ ...module, steps: [...module.steps, step] }); setSelection({ type: "step", stepId: step.id }) }} className="h-10 rounded-lg border border-neutral-700 text-xs text-neutral-300">Add form step</button><button type="button" onClick={() => { const step = newStep("video"); update({ ...module, steps: [...module.steps, step] }); setSelection({ type: "step", stepId: step.id }) }} className="h-10 rounded-lg border border-neutral-700 text-xs text-neutral-300">Add video step</button></div></Pane>
}

function FieldInspector({ field, update, remove }: { field: ConfiguredOnboardingField; update: (field: ConfiguredOnboardingField) => void; remove: () => void }) {
    return <div className="space-y-4"><label className="block text-sm text-neutral-300">Field label<input value={field.label} onChange={(event) => update({ ...field, label: event.target.value })} className="mt-2 h-10 w-full rounded-lg border border-neutral-700 bg-black px-3 text-white" /></label><label className="block text-sm text-neutral-300">Field type<select value={field.type} onChange={(event) => { const type = event.target.value as ConfiguredOnboardingField["type"]; update({ ...field, type, multiple: type === "file" ? field.type === "file" ? field.multiple : true : false, accept: type === "file" ? field.accept : "any" }) }} className="mt-2 h-10 w-full rounded-lg border border-neutral-700 bg-black px-3 text-white"><option value="text">Short text</option><option value="email">Email</option><option value="tel">Phone</option><option value="url">URL</option><option value="textarea">Long text</option><option value="file">File</option></select></label><label className="block text-sm text-neutral-300">Help text <span className="text-neutral-600">(optional)</span><textarea value={field.helpText} onChange={(event) => update({ ...field, helpText: event.target.value })} rows={2} className="mt-2 w-full rounded-lg border border-neutral-700 bg-black px-3 py-2 text-white" /></label>{field.type !== "file" ? <label className="block text-sm text-neutral-300">Placeholder <span className="text-neutral-600">(optional)</span><input value={field.placeholder} onChange={(event) => update({ ...field, placeholder: event.target.value })} className="mt-2 h-10 w-full rounded-lg border border-neutral-700 bg-black px-3 text-white" /></label> : <details className="rounded-lg border border-neutral-800 bg-black/40 p-3"><summary className="cursor-pointer text-sm text-neutral-300">Advanced file controls</summary><label className="mt-3 block text-sm text-neutral-400">Accepted files<select value={field.accept} onChange={(event) => update({ ...field, accept: event.target.value as ConfiguredOnboardingField["accept"] })} className="mt-2 h-10 w-full rounded-lg border border-neutral-700 bg-black px-3 text-white"><option value="any">Any file</option><option value="image">Images</option><option value="video">Videos</option><option value="document">Documents</option></select></label><label className="mt-3 flex min-h-10 items-center gap-2 text-sm text-neutral-400"><input type="checkbox" checked={field.multiple} onChange={(event) => update({ ...field, multiple: event.target.checked })} className="h-4 w-4 accent-white" />Allow multiple files</label><p className="mt-2 text-xs text-neutral-600">Maximum 500 MB per file.</p></details>}<label className="flex min-h-10 items-center gap-2 rounded-lg border border-neutral-800 bg-black px-3 text-sm text-neutral-300"><input type="checkbox" checked={field.required} onChange={(event) => update({ ...field, required: event.target.checked })} className="h-4 w-4 accent-white" />Required field</label><button type="button" onClick={remove} className="text-sm text-red-300/80 hover:text-red-200">Delete field</button></div>
}

function StepInspector({ workspaceSlug, module, step, update, remove, addField }: { workspaceSlug: string; module: OnboardingModuleDefinition; step: ConfiguredOnboardingStep; update: (step: ConfiguredOnboardingStep) => void; remove: () => void; addField: () => void }) {
    const [uploading, setUploading] = useState(false)
    const [uploadError, setUploadError] = useState<string | null>(null)
    async function upload(file: File) {
        if (!module.revisionId) { setUploadError("Save the module draft before uploading video."); return }
        setUploading(true); setUploadError(null)
        try {
            const prepared = await prepareBuilderVideoUpload(workspaceSlug, module.id, module.revisionId, { name: file.name, size: file.size, type: file.type })
            const response = await fetch(prepared.uploadUrl, { method: "PUT", headers: { "Content-Type": file.type }, body: file })
            if (!response.ok) throw new Error(`Upload failed with status ${response.status}.`)
            update({ ...step, videoPath: prepared.storedVideo.path, videoUrl: "", resolvedVideoUrl: prepared.previewUrl })
        } catch (error) { setUploadError(error instanceof Error ? error.message : "Video upload failed.") }
        finally { setUploading(false) }
    }
    return <div className="space-y-4"><label className="block text-sm text-neutral-300">Step title<input value={step.title} onChange={(event) => update({ ...step, title: event.target.value })} className="mt-2 h-10 w-full rounded-lg border border-neutral-700 bg-black px-3 text-white" /></label><label className="block text-sm text-neutral-300">Description<textarea value={step.description} onChange={(event) => update({ ...step, description: event.target.value })} rows={3} className="mt-2 w-full rounded-lg border border-neutral-700 bg-black px-3 py-2 text-white" /></label><label className="block text-sm text-neutral-300">Estimated time<input value={step.estimatedTime} onChange={(event) => update({ ...step, estimatedTime: event.target.value })} placeholder="2–3 minutes" className="mt-2 h-10 w-full rounded-lg border border-neutral-700 bg-black px-3 text-white" /></label><label className="block text-sm text-neutral-300">Why we ask<textarea value={step.why} onChange={(event) => update({ ...step, why: event.target.value })} rows={3} className="mt-2 w-full rounded-lg border border-neutral-700 bg-black px-3 py-2 text-white" /></label>{step.kind === "video" ? <div className="space-y-3 rounded-xl border border-neutral-800 bg-black/40 p-3"><label className="block text-sm text-neutral-300">Video URL<input value={step.videoUrl} onChange={(event) => update({ ...step, videoUrl: event.target.value, videoPath: event.target.value ? null : step.videoPath })} placeholder="https://www.loom.com/share/…" className="mt-2 h-10 w-full rounded-lg border border-neutral-700 bg-black px-3 text-white" /></label><div className="flex items-center gap-3"><span className="text-xs text-neutral-600">or</span><label className="cursor-pointer rounded-lg border border-neutral-700 px-3 py-2 text-xs text-neutral-300">{uploading ? "Uploading…" : "Upload video"}<input type="file" accept="video/*" disabled={uploading} onChange={(event) => { const file = event.target.files?.[0]; if (file) void upload(file) }} className="sr-only" /></label>{step.videoPath ? <span className="min-w-0 flex-1 truncate text-xs text-emerald-300">Uploaded video attached</span> : null}</div>{uploadError ? <p className="text-xs text-red-300">{uploadError}</p> : null}</div> : <button type="button" onClick={addField} className="h-10 rounded-lg border border-neutral-700 px-3 text-sm text-neutral-300">Add field</button>}<button type="button" disabled={module.steps.length <= 1} onClick={remove} className="text-sm text-red-300/80 hover:text-red-200 disabled:opacity-30">Delete step</button></div>
}

function ModuleInspector({ module, summary, update, children }: { module: OnboardingModuleDefinition; summary?: OnboardingModuleSummary; update: (module: OnboardingModuleDefinition) => void; children?: ReactNode }) {
    return <div className="space-y-4"><label className="block text-sm text-neutral-300">Module name<input value={module.name} onChange={(event) => update({ ...module, name: event.target.value })} className="mt-2 h-10 w-full rounded-lg border border-neutral-700 bg-black px-3 text-white" /></label><label className="block text-sm text-neutral-300">Description <span className="text-neutral-600">(optional)</span><textarea value={module.description} onChange={(event) => update({ ...module, description: event.target.value })} rows={3} className="mt-2 w-full rounded-lg border border-neutral-700 bg-black px-3 py-2 text-white" /></label><label className="flex min-h-10 items-center gap-2 rounded-lg border border-neutral-800 bg-black px-3 text-sm text-neutral-300"><input type="checkbox" checked={module.isTest} onChange={(event) => update({ ...module, isTest: event.target.checked })} className="h-4 w-4 accent-white" />Mark this module as Test</label><dl className="grid grid-cols-2 gap-2 rounded-xl border border-neutral-800 bg-black/40 p-3 text-xs"><div><dt className="text-neutral-600">Internal code</dt><dd className="mt-1 truncate font-mono text-neutral-300">{module.code}</dd></div><div><dt className="text-neutral-600">Version</dt><dd className="mt-1 text-neutral-300">{module.version}</dd></div><div><dt className="text-neutral-600">Mandatory</dt><dd className="mt-1 text-neutral-300">{summary?.mandatory ? "Yes" : "No"}</dd></div><div><dt className="text-neutral-600">Used by</dt><dd className="mt-1 truncate text-neutral-300">{summary?.usedBy.map((service) => service.name).join(", ") || "No services"}</dd></div></dl>{children}</div>
}

function PublishDialog({ module, impact, close, publish, pending, error }: { module: OnboardingModuleDefinition; impact: OnboardingModulePublishImpact; close: () => void; publish: (active: boolean, explanation: string) => void; pending: boolean; error: string | null }) {
    const [active, setActive] = useState(false)
    const [explanation, setExplanation] = useState("We updated this part of your onboarding so we can collect the right information. Please complete it again.")
    const changeParts = [
        impact.addedSteps ? `+${impact.addedSteps} step${impact.addedSteps === 1 ? "" : "s"}` : null,
        impact.removedSteps ? `−${impact.removedSteps} step${impact.removedSteps === 1 ? "" : "s"}` : null,
        impact.addedFields ? `+${impact.addedFields} field${impact.addedFields === 1 ? "" : "s"}` : null,
        impact.removedFields ? `−${impact.removedFields} field${impact.removedFields === 1 ? "" : "s"}` : null,
        impact.orderChanged ? "order changed" : null,
    ].filter(Boolean)
    return <div role="dialog" aria-modal="true" aria-labelledby="publish-module-title" className="fixed inset-0 z-[100] flex items-center justify-center bg-black/75 p-3 backdrop-blur-sm"><div className="max-h-[calc(100dvh-1.5rem)] w-full max-w-xl overflow-y-auto rounded-2xl border border-neutral-700 bg-neutral-950 shadow-2xl"><div className="flex items-start gap-4 border-b border-neutral-800 p-4"><div className="min-w-0 flex-1"><h2 id="publish-module-title" className="text-lg font-semibold">Publish {module.name}</h2><p className="mt-1 text-sm text-neutral-500">{impact.draftStepCount} steps · {impact.draftFieldCount} fields</p></div><button type="button" onClick={close} aria-label="Close publish dialog" className="text-xl text-neutral-500">×</button></div><div className="space-y-3 p-4"><div className="rounded-xl border border-neutral-800 bg-black/40 p-3 text-xs leading-5 text-neutral-400"><p className="font-medium text-neutral-200">Publication impact</p><p className="mt-1">Services: {impact.serviceNames.length ? `${impact.serviceNames.length} · ${impact.serviceNames.join(", ")}` : "No active services"}</p><p>Active sessions containing this module: {impact.activeSessionCount}</p><p className="mt-1">{impact.publishedVersion === null ? `First publication · ${impact.draftStepCount} steps and ${impact.draftFieldCount} fields` : `Published v${impact.publishedVersion} → draft · steps ${impact.publishedStepCount} → ${impact.draftStepCount} · fields ${impact.publishedFieldCount} → ${impact.draftFieldCount}`}</p><p>{changeParts.length ? changeParts.join(" · ") : "No structural step or field changes detected."}</p></div><label className={`block rounded-xl border p-3 ${!active ? "border-white bg-white/5" : "border-neutral-800"}`}><input type="radio" checked={!active} onChange={() => setActive(false)} className="mr-2 accent-white" /><span className="font-medium">Future sessions only</span><span className="mt-1 block pl-6 text-xs text-neutral-500">Existing sessions keep their current snapshot.</span></label><label className={`block rounded-xl border p-3 ${active ? "border-white bg-white/5" : "border-neutral-800"}`}><input type="radio" checked={active} onChange={() => setActive(true)} className="mr-2 accent-white" /><span className="font-medium">Future and all affected active sessions</span><span className="mt-1 block pl-6 text-xs leading-5 text-neutral-500">Resets {impact.activeSessionCount} active session{impact.activeSessionCount === 1 ? "" : "s"} atomically. Completed sessions and unrelated modules stay frozen.</span></label>{active ? <label className="block text-sm text-neutral-300">Client explanation<textarea value={explanation} onChange={(event) => setExplanation(event.target.value)} rows={3} className="mt-2 w-full rounded-lg border border-neutral-700 bg-black px-3 py-2 text-white" /></label> : null}{error ? <p role="alert" className="text-sm text-red-300">{error}</p> : null}</div><div className="flex justify-end gap-2 border-t border-neutral-800 p-4"><button type="button" onClick={close} className="h-10 px-3 text-sm text-neutral-400">Cancel</button><button type="button" disabled={pending} onClick={() => publish(active, explanation)} className="h-10 rounded-lg bg-white px-4 text-sm font-medium text-black disabled:opacity-40">{pending ? "Publishing…" : "Publish module"}</button></div></div></div>
}

export function OnboardingBuilderWorkspace({
    workspaceSlug,
    workspaceName,
    data,
    initialBookend,
}: {
    workspaceSlug: string
    workspaceName: string
    data: OnboardingBuilderData
    initialBookend?: "welcome" | "completion" | null
}) {
    const router = useRouter()
    const initialModuleId = data.selectedModule?.id ?? data.moduleDefinitions[0]?.id ?? ""
    const [librarySelection, setLibrarySelection] = useState<LibrarySelection>(
        initialBookend ? { type: "bookend", kind: initialBookend } : { type: "module", id: initialModuleId },
    )
    const [definitions, setDefinitions] = useState(data.moduleDefinitions)
    const [welcome, setWelcome] = useState(data.welcome)
    const [completion, setCompletion] = useState(data.completion)
    const [selection, setSelection] = useState<Selection>({ type: "module" })
    const [mobilePane, setMobilePane] = useState<"library" | "outline" | "inspector">("library")
    const [previewOpen, setPreviewOpen] = useState(false)
    const [publishOpen, setPublishOpen] = useState(false)
    const [actionErrorState, setActionErrorState] = useState<string | null>(null)
    const [previewUrl, setPreviewUrl] = useState<string | null>(null)
    const [pending, startTransition] = useTransition()
    const bookendSaveTimer = useRef<number | null>(null)

    const selectedModule = librarySelection.type === "module"
        ? definitions.find((item) => item.id === librarySelection.id) ?? null
        : null
    const summary = selectedModule ? data.modules.find((item) => item.id === selectedModule.id) : undefined
    const publishImpact = selectedModule ? {
        ...data.publishImpactByModule[selectedModule.id],
        ...modulePublishDiff(selectedModule, data.publishedModuleDefinitions[selectedModule.id] ?? undefined),
    } : null
    const bookend = librarySelection.type === "bookend"
        ? librarySelection.kind === "welcome" ? welcome : completion
        : null
    const autosave = useModuleAutosave(
        workspaceSlug,
        selectedModule,
        data.schemaReady && Boolean(selectedModule) && !selectedModule?.id.startsWith("legacy:"),
    )
    const selectedStep = selectedModule && selection.type !== "module"
        ? selectedModule.steps.find((step) => step.id === selection.stepId) ?? null
        : null
    const selectedField = selectedStep && selection.type === "field"
        ? selectedStep.fields.find((field) => field.id === selection.fieldId) ?? null
        : null

    function choose(next: LibrarySelection) {
        setLibrarySelection(next)
        setSelection({ type: "module" })
        setMobilePane(next.type === "module" ? "outline" : "inspector")
        setActionErrorState(null)
    }

    function replaceModule(next: OnboardingModuleDefinition) {
        setDefinitions((items) => items.map((item) => item.id === next.id ? next : item))
    }

    function run(
        action: () => Promise<{ ok: boolean; error?: string; data?: Record<string, unknown> }>,
        after?: (result?: Record<string, unknown>) => void,
    ) {
        setActionErrorState(null)
        startTransition(async () => {
            const outcome = await action()
            const error = actionError(outcome, "The Builder action could not be completed.")
            if (error) {
                setActionErrorState(error)
                return
            }
            after?.(outcome.data)
            router.refresh()
        })
    }

    function saveBookend(next: OnboardingBookendDefinition) {
        if (next.kind === "welcome") setWelcome(next)
        else setCompletion(next)
        if (bookendSaveTimer.current) window.clearTimeout(bookendSaveTimer.current)
        bookendSaveTimer.current = window.setTimeout(async () => {
            const outcome = await saveOnboardingBookendDraft(workspaceSlug, next.kind, next)
            if (!outcome.ok) setActionErrorState(outcome.error)
        }, 750)
    }

    let inspector: ReactNode = <p className="text-sm text-neutral-600">Choose a module or bookend.</p>
    if (bookend) {
        inspector = (
            <div className="space-y-4">
                <label className="block text-sm text-neutral-300">
                    Title
                    <input value={bookend.title} onChange={(event) => saveBookend({ ...bookend, title: event.target.value })} className="mt-2 h-10 w-full rounded-lg border border-neutral-700 bg-black px-3 text-white" />
                </label>
                <label className="block text-sm text-neutral-300">
                    Body
                    <textarea value={bookend.body} onChange={(event) => saveBookend({ ...bookend, body: event.target.value })} rows={5} className="mt-2 w-full rounded-lg border border-neutral-700 bg-black px-3 py-2 text-white" />
                </label>
                <label className="block text-sm text-neutral-300">
                    Video URL <span className="text-neutral-600">(optional)</span>
                    <input value={bookend.videoUrl} onChange={(event) => saveBookend({ ...bookend, videoUrl: event.target.value })} className="mt-2 h-10 w-full rounded-lg border border-neutral-700 bg-black px-3 text-white" />
                </label>
                <p className="text-xs leading-5 text-neutral-600">
                    {bookend.kind === "welcome"
                        ? "Welcome publishing affects future sessions only."
                        : "Completion publishing updates future and active-incomplete sessions. Completed sessions remain frozen."}
                </p>
                <button type="button" disabled={pending || !data.schemaReady} onClick={() => run(() => publishOnboardingBookend(workspaceSlug, bookend.kind, bookend))} className="h-10 rounded-lg bg-white px-4 text-sm font-medium text-black disabled:opacity-30">
                    {pending ? "Publishing…" : `Publish ${bookend.kind}`}
                </button>
            </div>
        )
    } else if (selectedModule && selection.type === "module") {
        inspector = (
            <ModuleInspector module={selectedModule} summary={summary} update={replaceModule}>
                <div className="flex flex-wrap gap-2">
                    <button type="button" disabled={pending || !data.schemaReady} onClick={() => setPublishOpen(true)} className="h-10 rounded-lg bg-white px-3 text-sm font-medium text-black disabled:opacity-30">Publish</button>
                    <button type="button" disabled={pending || !data.schemaReady} onClick={() => run(
                        () => duplicateOnboardingModule(workspaceSlug, selectedModule.id),
                        (result) => {
                            const id = String(result?.module_id ?? "")
                            if (id) router.push(`/${workspaceSlug}/onboarding-builder?module=${id}`)
                        },
                    )} className="h-10 rounded-lg border border-neutral-700 px-3 text-sm text-neutral-300">Duplicate</button>
                    <button type="button" disabled={pending || !data.schemaReady} onClick={() => run(
                        () => rotateOnboardingModulePreview(workspaceSlug, selectedModule.id, selectedModule),
                        (result) => {
                            const token = String(result?.token ?? "")
                            if (token) setPreviewUrl(`${window.location.origin}/onboarding/preview/${token}`)
                        },
                    )} className="h-10 rounded-lg border border-neutral-700 px-3 text-sm text-neutral-300">Create preview link</button>
                </div>
                {previewUrl ? (
                    <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-xs text-emerald-100">
                        <p className="break-all">{previewUrl}</p>
                        <div className="mt-2 flex items-center gap-3">
                            <button type="button" onClick={() => void navigator.clipboard.writeText(previewUrl)} className="underline underline-offset-4">Copy 24-hour link</button>
                            <button type="button" disabled={pending} onClick={() => run(
                                () => revokeOnboardingModulePreview(workspaceSlug, selectedModule.id),
                                () => setPreviewUrl(null),
                            )} className="text-red-200 underline underline-offset-4 disabled:opacity-40">Revoke link</button>
                        </div>
                    </div>
                ) : null}
                <div className="border-t border-neutral-800 pt-3">
                    {selectedModule.status === "archived" ? (
                        <button type="button" disabled={pending} onClick={() => run(() => restoreOnboardingModule(workspaceSlug, selectedModule.id))} className="text-sm text-neutral-300">Restore module</button>
                    ) : (
                        <button type="button" disabled={pending || Boolean(summary?.mandatory) || Boolean(summary?.usedBy.length)} onClick={() => run(() => archiveOnboardingModule(workspaceSlug, selectedModule.id))} className="text-sm text-red-300/80 disabled:opacity-30">Archive module</button>
                    )}
                    {selectedModule.status === "draft" && data.publishImpactByModule[selectedModule.id]?.publishedVersion === null ? (
                        <button type="button" disabled={pending} onClick={() => run(
                            () => deleteOnboardingModuleDraft(workspaceSlug, selectedModule.id),
                            () => router.push(`/${workspaceSlug}/onboarding-builder`),
                        )} className="ml-3 text-sm text-red-300/80">Delete draft permanently</button>
                    ) : null}
                </div>
            </ModuleInspector>
        )
    } else if (selectedModule && selectedStep && selection.type === "step") {
        inspector = (
            <StepInspector
                workspaceSlug={workspaceSlug}
                module={selectedModule}
                step={selectedStep}
                update={(step) => replaceModule({
                    ...selectedModule,
                    steps: selectedModule.steps.map((item) => item.id === step.id ? step : item),
                })}
                remove={() => {
                    replaceModule({ ...selectedModule, steps: selectedModule.steps.filter((item) => item.id !== selectedStep.id) })
                    setSelection({ type: "module" })
                }}
                addField={() => {
                    const field = newField()
                    replaceModule({
                        ...selectedModule,
                        steps: selectedModule.steps.map((step) => step.id === selectedStep.id ? { ...step, fields: [...step.fields, field] } : step),
                    })
                    setSelection({ type: "field", stepId: selectedStep.id, fieldId: field.id })
                }}
            />
        )
    } else if (selectedModule && selectedStep && selectedField) {
        inspector = (
            <FieldInspector
                field={selectedField}
                update={(field) => replaceModule({
                    ...selectedModule,
                    steps: selectedModule.steps.map((step) => step.id === selectedStep.id
                        ? { ...step, fields: step.fields.map((item) => item.id === field.id ? field : item) }
                        : step),
                })}
                remove={() => {
                    replaceModule({
                        ...selectedModule,
                        steps: selectedModule.steps.map((step) => step.id === selectedStep.id
                            ? { ...step, fields: step.fields.filter((item) => item.id !== selectedField.id) }
                            : step),
                    })
                    setSelection({ type: "step", stepId: selectedStep.id })
                }}
            />
        )
    } else if (selectedModule) {
        inspector = <p className="text-sm text-neutral-600">Choose an item from the outline.</p>
    }

    const lastEditorName = selectedModule?.lastEditedBy ? data.editors[selectedModule.lastEditedBy] ?? "another workspace admin" : null
    const inspectorDetail = selectedModule
        ? `${autosave.state === "saving" ? "Saving…" : autosave.state === "saved" ? "Saved" : autosave.state === "error" ? "Save error" : "Draft autosaves"}${selectedModule.lastEditedAt ? ` · last edited${lastEditorName ? ` by ${lastEditorName}` : ""} ${new Date(selectedModule.lastEditedAt).toLocaleString()}` : ""}`
        : bookend ? "Locked bookend draft" : "Choose content"

    return (
        <div>
            <div className="mb-3 flex items-center justify-between gap-3 lg:hidden">
                <div className="flex rounded-lg border border-neutral-800 bg-neutral-900 p-1">
                    {(["library", "outline", "inspector"] as const).map((pane) => (
                        <button key={pane} type="button" disabled={pane === "outline" && !selectedModule} onClick={() => setMobilePane(pane)} className={`rounded-md px-3 py-2 text-xs capitalize ${mobilePane === pane ? "bg-white text-black" : "text-neutral-400"}`}>{pane}</button>
                    ))}
                </div>
                <button type="button" onClick={() => setPreviewOpen(true)} className="h-10 rounded-lg border border-neutral-700 px-3 text-xs text-neutral-200">Preview</button>
            </div>
            {!data.schemaReady ? (
                <p className="mb-3 rounded-xl border border-yellow-500/30 bg-yellow-500/10 px-4 py-3 text-sm text-yellow-100">Builder is showing legacy definitions read-only until the new onboarding schema is available.</p>
            ) : null}
            <div className="grid min-h-[42rem] gap-3 lg:h-[calc(100dvh-3rem)] lg:min-h-[42rem] lg:grid-cols-[17rem_20rem_minmax(0,1fr)]">
                <div className={mobilePane === "library" ? "min-h-[34rem]" : "hidden lg:block"}>
                    <LibraryPane
                        data={data}
                        selection={librarySelection}
                        select={choose}
                        pending={pending}
                        create={() => run(
                            () => createOnboardingModule(workspaceSlug),
                            (result) => {
                                const id = String(result?.module_id ?? "")
                                if (id) router.push(`/${workspaceSlug}/onboarding-builder?module=${id}`)
                            },
                        )}
                    />
                </div>
                <div className={mobilePane === "outline" ? "min-h-[34rem]" : "hidden lg:block"}>
                    <OutlinePane module={selectedModule} selection={selection} setSelection={(next) => { setSelection(next); setMobilePane("inspector") }} update={replaceModule} />
                </div>
                <div className={mobilePane === "inspector" ? "min-h-[34rem]" : "hidden lg:block"}>
                    <Pane title="Inspector and preview" detail={inspectorDetail} className="flex h-full flex-col">
                        <div className="min-h-0 flex-1 overflow-y-auto p-4">
                            <div className="grid min-h-0 gap-5 xl:grid-cols-[minmax(18rem,.72fr)_minmax(20rem,1.28fr)]">
                                <div>
                                    {inspector}
                                    {autosave.error || actionErrorState ? <p role="alert" className="mt-3 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-200">{autosave.error ?? actionErrorState}</p> : null}
                                </div>
                                <div className="hidden min-h-[34rem] xl:block">
                                    <BuilderPreview module={selectedModule} bookend={bookend} theme={data.theme} help={data.help} workspaceName={workspaceName} />
                                </div>
                            </div>
                        </div>
                        <div className="flex justify-end border-t border-neutral-800 p-2 xl:hidden">
                            <button type="button" onClick={() => setPreviewOpen(true)} className="h-10 rounded-lg border border-neutral-700 px-3 text-sm text-neutral-200">Open preview</button>
                        </div>
                    </Pane>
                </div>
            </div>
            {previewOpen ? (
                <div role="dialog" aria-modal="true" aria-label="Onboarding preview" className="fixed inset-0 z-[100] bg-neutral-950 p-2 sm:p-4">
                    <div className="mx-auto flex h-full max-w-7xl flex-col">
                        <div className="mb-2 flex items-center justify-between">
                            <p className="text-sm font-medium">Client preview</p>
                            <button type="button" onClick={() => setPreviewOpen(false)} className="h-10 rounded-lg border border-neutral-700 px-3 text-sm text-neutral-200">Close preview</button>
                        </div>
                        <div className="min-h-0 flex-1">
                            <BuilderPreview module={selectedModule} bookend={bookend} theme={data.theme} help={data.help} workspaceName={workspaceName} />
                        </div>
                    </div>
                </div>
            ) : null}
            {publishOpen && selectedModule ? (
                <PublishDialog
                    module={selectedModule}
                    impact={publishImpact!}
                    pending={pending}
                    error={actionErrorState}
                    close={() => { setPublishOpen(false); setActionErrorState(null) }}
                    publish={(active, explanation) => run(
                        () => publishOnboardingModule(workspaceSlug, selectedModule.id, selectedModule, active, explanation),
                        () => setPublishOpen(false),
                    )}
                />
            ) : null}
        </div>
    )
}
