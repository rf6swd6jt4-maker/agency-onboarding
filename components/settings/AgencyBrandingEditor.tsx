"use client"

import { useEffect, useMemo, useRef, useState, useTransition } from "react"
import { createPortal } from "react-dom"
import { saveAgencyBranding } from "@/app/[workspaceSlug]/settings/branding-actions"
import { publishVisualThemeDraft } from "@/app/[workspaceSlug]/onboarding-builder/visual-actions"
import { ColourStyleEditor } from "@/components/settings/ColourStyleEditor"
import { BuilderPreview } from "@/components/onboarding-builder/BuilderPreview"
import { EditIcon } from "@/components/communications/MessageInteractionIcons"
import { ONBOARDING_THEME_SLOTS, type OnboardingBookendDefinition, type OnboardingBrandSwatch, type OnboardingHelpSettings, type OnboardingThemeDefinition, type OnboardingThemeSlot } from "@/lib/onboarding/configuration-types"
import { normalizeHexColour, ONBOARDING_THEME_SLOT_LABELS, onboardingThemeWarnings } from "@/lib/onboarding/theme"
import { runWorkspaceMutation } from "@/lib/workspace-mutations"
import { WorkspaceActionButton } from "@/components/workspace/WorkspaceActionButton"

function themeKey(theme: OnboardingThemeDefinition) {
    return JSON.stringify({ swatches: theme.swatches, assignments: theme.assignments })
}

function assignedColour(theme: OnboardingThemeDefinition, slot: OnboardingThemeSlot) {
    const swatch = theme.swatches.find((candidate) => candidate.id === theme.assignments[slot])
    return { name: swatch?.name ?? "Default colour", hex: normalizeHexColour(swatch?.hex) ?? "#000000" }
}

export function AgencyBrandingEditor({ workspaceSlug, workspaceName, initialTheme, publishedTheme: initialPublishedTheme, previewBookend, help, schemaReady, faviconSrc, uploadFavicon }: { workspaceSlug: string; workspaceName: string; initialTheme: OnboardingThemeDefinition; publishedTheme: OnboardingThemeDefinition; previewBookend: OnboardingBookendDefinition; help: OnboardingHelpSettings; schemaReady: boolean; faviconSrc: string | null; uploadFavicon: (formData: FormData) => Promise<void> }) {
    const [theme, setTheme] = useState(initialTheme)
    const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle")
    const [error, setError] = useState<string | null>(null)
    const [publishPending, startPublish] = useTransition()
    const [assignmentEditor, setAssignmentEditor] = useState<{ slot: OnboardingThemeSlot } | null>(null)
    const [previewOpen, setPreviewOpen] = useState(false)
    const [publishReviewOpen, setPublishReviewOpen] = useState(false)
    const [publishedTheme, setPublishedTheme] = useState(initialPublishedTheme)
    const latestRef = useRef(theme)
    const lastSavedRef = useRef(themeKey(initialTheme))
    const timerRef = useRef<number | null>(null)
    const saveQueueRef = useRef(Promise.resolve())
    const warnings = useMemo(() => onboardingThemeWarnings(theme), [theme])
    const colourChanges = useMemo(() => ONBOARDING_THEME_SLOTS.flatMap((slot) => {
        const current = assignedColour(publishedTheme, slot)
        const next = assignedColour(theme, slot)
        return current.hex === next.hex ? [] : [{ slot, current, next }]
    }), [publishedTheme, theme])

    useEffect(() => { latestRef.current = theme }, [theme])

    useEffect(() => {
        if (!assignmentEditor) return
        const hostDocument = window.parent !== window ? window.parent.document : document
        const dismiss = (event: globalThis.KeyboardEvent) => {
            if (event.key === "Escape") setAssignmentEditor(null)
        }
        hostDocument.addEventListener("keydown", dismiss)
        return () => hostDocument.removeEventListener("keydown", dismiss)
    }, [assignmentEditor])

    useEffect(() => {
        if (!previewOpen) return
        const hostDocument = window.parent !== window ? window.parent.document : document
        const dismiss = (event: globalThis.KeyboardEvent) => {
            if (event.key !== "Escape") return
            if (publishReviewOpen) setPublishReviewOpen(false)
            else setPreviewOpen(false)
        }
        hostDocument.addEventListener("keydown", dismiss)
        return () => hostDocument.removeEventListener("keydown", dismiss)
    }, [previewOpen, publishReviewOpen])

    useEffect(() => {
        if (!schemaReady || themeKey(theme) === lastSavedRef.current) return
        if (timerRef.current) window.clearTimeout(timerRef.current)
        const payload = theme
        const payloadKey = themeKey(payload)
        timerRef.current = window.setTimeout(() => {
            saveQueueRef.current = saveQueueRef.current.then(async () => {
                if (payloadKey === lastSavedRef.current) return
                setSaveState("saving")
                setError(null)
                const outcome = await runWorkspaceMutation(() => saveAgencyBranding(workspaceSlug, payload.swatches, payload.assignments))
                if (!outcome.ok) {
                    setSaveState("error")
                    setError(outcome.error)
                    return
                }
                lastSavedRef.current = payloadKey
                if (themeKey(latestRef.current) === payloadKey) setSaveState("saved")
            })
        }, 700)
        return () => { if (timerRef.current) window.clearTimeout(timerRef.current) }
    }, [schemaReady, theme, workspaceSlug])

    function updateSwatch(id: string, update: Partial<OnboardingBrandSwatch>) {
        setTheme((current) => ({ ...current, swatches: current.swatches.map((swatch) => swatch.id === id ? { ...swatch, ...update } : swatch) }))
    }

    function openAssignmentEditor(slot: OnboardingThemeSlot) {
        setAssignmentEditor({ slot })
    }

    function assignSwatch(slot: OnboardingThemeSlot, swatchId: string) {
        setTheme((current) => ({
            ...current,
            swatches: current.swatches.map((swatch) => swatch.id === swatchId ? { ...swatch, hidden: false } : swatch),
            assignments: { ...current.assignments, [slot]: swatchId },
        }))
    }

    function createAndAssignSwatch(slot: OnboardingThemeSlot, name: string, hex: string) {
        const id = crypto.randomUUID()
        setTheme((current) => ({
            ...current,
            swatches: [...current.swatches, { id, name, hex, hidden: false }],
            assignments: { ...current.assignments, [slot]: id },
        }))
    }

    function publishLatestTheme() {
        const payload = latestRef.current
        setError(null)
        startPublish(async () => {
            const outcome = await publishVisualThemeDraft(workspaceSlug, payload)
            if (!outcome.ok) {
                setError(outcome.error)
                return
            }
            setPublishedTheme(payload)
            setPublishReviewOpen(false)
        })
    }

    const editedSlot = assignmentEditor?.slot ?? null
    const editedAssignment = editedSlot ? theme.swatches.find((swatch) => swatch.id === theme.assignments[editedSlot]) : null
    const modalTarget = typeof window !== "undefined" ? (window.parent !== window ? window.parent.document.body : document.body) : null

    return <div className="min-w-0 max-w-full space-y-5">
            {!schemaReady ? <p className="rounded-xl border border-yellow-500/30 bg-yellow-500/10 px-4 py-3 text-sm text-yellow-100">Theme controls are read-only until the onboarding configuration schema is deployed.</p> : null}
            <section className="rounded-2xl border border-neutral-800 bg-neutral-900 p-4 sm:p-5">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex min-w-0 items-center gap-3 sm:gap-4">
                        <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-neutral-700 bg-black p-2">
                            {/* Signed workspace-logo URLs are already resized by the token-scoped favicon endpoint. */}
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={faviconSrc ?? "/icon.svg"} alt="Client browser favicon preview" className="h-full w-full object-contain" />
                        </div>
                        <div className="min-w-0"><h3 className="font-semibold">Client-facing favicon</h3><p className="mt-1 max-w-xl text-sm leading-6 text-neutral-500">Your workspace logo appears in browser tabs for onboarding and the client portal. Uploading here also updates the workspace logo.</p></div>
                    </div>
                    <form action={uploadFavicon} data-workspace-mutation="background" className="flex min-w-0 max-w-full flex-col items-stretch gap-2 sm:shrink-0 sm:flex-row sm:items-center">
                        <input name="logo" required type="file" accept="image/png,image/jpeg,image/gif,image/webp" aria-label="Client-facing favicon image" className="min-w-0 max-w-full text-xs text-neutral-400 file:mr-2 file:max-w-full file:rounded-lg file:border-0 file:bg-neutral-800 file:px-3 file:py-2 file:text-sm file:text-white sm:max-w-56" />
                        <WorkspaceActionButton pendingLabel="Uploading…" className="h-10 shrink-0 rounded-lg bg-white px-3 text-sm font-medium text-black">{faviconSrc ? "Replace" : "Upload"}</WorkspaceActionButton>
                    </form>
                </div>
            </section>
            <section className="rounded-2xl border border-neutral-800 bg-neutral-900 p-4 sm:p-5">
                <h3 className="font-semibold">Client colour roles</h3>
                <p className="mt-1 text-sm leading-6 text-neutral-500">Select a role to view the palette or change its assigned colour.</p>
                <div className="mt-4 grid overflow-hidden rounded-xl border border-neutral-800 bg-black sm:grid-cols-2">
                    {ONBOARDING_THEME_SLOTS.map((slot, index) => {
                        const assigned = theme.swatches.find((swatch) => swatch.id === theme.assignments[slot])
                        return <button
                            key={slot}
                            type="button"
                            aria-haspopup="dialog"
                            aria-expanded={assignmentEditor?.slot === slot}
                            disabled={!schemaReady}
                            onClick={() => openAssignmentEditor(slot)}
                            className={`flex min-w-0 items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-neutral-900 disabled:cursor-default disabled:opacity-50 ${index > 0 ? "border-t border-neutral-800" : ""} ${index === 1 ? "sm:border-t-0" : ""} ${index % 2 === 1 ? "sm:border-l sm:border-neutral-800" : ""}`}
                        >
                            <span aria-hidden="true" className="h-7 w-7 shrink-0 rounded-md border border-white/10" style={{ backgroundColor: normalizeHexColour(assigned?.hex) ?? "#000000" }} />
                            <span className="min-w-0 flex-1"><span className="block truncate text-sm text-neutral-200">{ONBOARDING_THEME_SLOT_LABELS[slot]}</span><span className="mt-0.5 block truncate text-xs text-neutral-500">{assigned?.name ?? "Default colour"}</span></span>
                            <EditIcon className="h-4 w-4 shrink-0 text-neutral-600" />
                        </button>
                    })}
                </div>
            </section>
            {warnings.length ? <section className="rounded-xl border border-yellow-500/30 bg-yellow-500/10 px-4 py-3 text-sm text-yellow-100"><h3 className="font-medium">Contrast warnings</h3><ul className="mt-2 list-disc space-y-1 pl-5 text-xs leading-5 text-yellow-100/80">{warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul><p className="mt-2 text-xs text-yellow-100/70">Warnings do not block saving.</p></section> : null}
            <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div aria-live="polite" className="min-h-5 min-w-0 text-xs text-neutral-500">{saveState === "saving" ? "Saving style draft…" : saveState === "saved" ? colourChanges.length ? "Unpublished style draft saved" : "Style is up to date" : saveState === "error" ? error : schemaReady ? colourChanges.length ? "Unpublished style draft" : "Style is up to date" : "Read-only compatibility view"}</div><button type="button" onClick={() => setPreviewOpen(true)} className="inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-lg bg-white px-4 text-sm font-medium text-black"><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" /><circle cx="12" cy="12" r="3" /></svg>Preview</button></div>
        {previewOpen && modalTarget ? createPortal(<div data-agency-branding-preview className="fixed inset-0 z-[2147483646] overflow-hidden bg-neutral-100 text-white">
            <div className="pointer-events-none absolute inset-x-0 top-0 z-20 flex items-start justify-between gap-3 p-3 sm:p-4">
                <button type="button" onClick={() => { setPreviewOpen(false); setPublishReviewOpen(false) }} className="pointer-events-auto rounded-full border border-white/20 bg-neutral-700 px-5 py-2.5 text-sm font-semibold text-white shadow-[0_8px_20px_rgba(0,0,0,0.24)] transition hover:bg-neutral-600 focus:outline-none focus:ring-2 focus:ring-white/70">Exit preview</button>
                <button type="button" disabled={!schemaReady || publishPending || !colourChanges.length} onClick={() => { setError(null); setPublishReviewOpen(true) }} className="pointer-events-auto rounded-full bg-white px-4 py-2.5 text-sm font-semibold text-black shadow-[0_8px_24px_rgba(15,23,42,0.30),0_2px_6px_rgba(15,23,42,0.18)] transition hover:bg-neutral-100 disabled:cursor-default disabled:opacity-45">{colourChanges.length ? "Publish" : "Published"}</button>
            </div>
            <div className="h-full min-h-0"><BuilderPreview bookend={previewBookend} theme={theme} help={help} workspaceName={workspaceName} /></div>
            {publishReviewOpen ? <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/75 p-3 backdrop-blur-sm sm:p-4" onMouseDown={(event) => { if (event.target === event.currentTarget && !publishPending) setPublishReviewOpen(false) }}>
                <section role="dialog" aria-modal="true" aria-labelledby="publish-colour-title" className="flex max-h-[min(90dvh,42rem)] w-full max-w-xl flex-col overflow-hidden rounded-2xl border border-neutral-700 bg-neutral-950 shadow-2xl shadow-black/70">
                    <div className="flex shrink-0 items-start justify-between gap-4 border-b border-neutral-800 p-4 sm:p-5"><div className="min-w-0"><h2 id="publish-colour-title" className="text-lg font-semibold">Review colour changes</h2><p className="mt-1 text-sm leading-5 text-neutral-500">Compare the colours clients see now with the latest saved draft.</p></div><button type="button" disabled={publishPending} aria-label="Close publish review" onClick={() => setPublishReviewOpen(false)} className="flex h-8 w-8 shrink-0 items-center justify-center text-lg text-neutral-500 hover:text-white disabled:opacity-30">×</button></div>
                    <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-5">
                        <div className="space-y-5">{colourChanges.map((change) => <div key={change.slot} className="px-1"><p className="mb-2 text-center text-xs font-medium text-neutral-500">{ONBOARDING_THEME_SLOT_LABELS[change.slot]}</p><div className="grid items-center gap-2" style={{ gridTemplateColumns: "minmax(0, 1fr) 2rem minmax(0, 1fr)" }}><span className="flex min-w-0 items-center justify-end gap-2"><span className="min-w-0 text-right"><span className="block truncate text-xs text-neutral-200">{change.current.name}</span><span className="block truncate font-mono text-[10px] text-neutral-600">{change.current.hex}</span></span><span aria-hidden="true" className="h-8 w-8 shrink-0 rounded-md border border-white/10" style={{ backgroundColor: change.current.hex }} /></span><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="h-4 w-4 justify-self-center text-neutral-500"><path d="M5 12h14M14 7l5 5-5 5" /></svg><span className="flex min-w-0 items-center gap-2"><span aria-hidden="true" className="h-8 w-8 shrink-0 rounded-md border border-white/10" style={{ backgroundColor: change.next.hex }} /><span className="min-w-0"><span className="block truncate text-xs text-neutral-200">{change.next.name}</span><span className="block truncate font-mono text-[10px] text-neutral-600">{change.next.hex}</span></span></span></div></div>)}</div>
                    </div>
                    {error ? <p role="alert" className="shrink-0 border-t border-red-900 bg-red-950/40 px-4 py-3 text-sm text-red-200">{error}</p> : null}
                    <div className="flex shrink-0 flex-col items-end gap-3 border-t border-neutral-800 p-4 sm:flex-row sm:justify-end"><p className="text-sm font-medium text-neutral-200">Publish {colourChanges.length} {colourChanges.length === 1 ? "change" : "changes"}?</p><button type="button" disabled={publishPending || !colourChanges.length} onClick={publishLatestTheme} className="h-10 w-full rounded-lg bg-white px-4 text-sm font-semibold text-black disabled:opacity-30 sm:w-auto">{publishPending ? "Publishing…" : "Publish changes"}</button></div>
                </section>
            </div> : null}
        </div>, modalTarget) : null}
        {assignmentEditor && editedSlot && modalTarget ? createPortal(<div className="fixed inset-0 z-[2147483646] flex items-center justify-center overflow-hidden overscroll-none bg-black/75 p-3 backdrop-blur-sm sm:p-4" onMouseDown={(event) => { if (event.target === event.currentTarget) setAssignmentEditor(null) }}>
            <section role="dialog" aria-modal="true" aria-labelledby="colour-style-editor-title" className="max-h-[min(92dvh,38rem)] w-full max-w-sm overflow-hidden rounded-2xl border border-neutral-700 bg-neutral-950 text-white shadow-2xl shadow-black/70">
                <ColourStyleEditor
                    key={editedSlot}
                    titleId="colour-style-editor-title"
                    roleLabel={ONBOARDING_THEME_SLOT_LABELS[editedSlot]}
                    assignedSwatch={editedAssignment ?? null}
                    swatches={theme.swatches}
                    onUpdateSwatch={updateSwatch}
                    onAssignSwatch={(swatchId) => assignSwatch(editedSlot, swatchId)}
                    onCreateSwatch={(name, hex) => createAndAssignSwatch(editedSlot, name, hex)}
                    onClose={() => setAssignmentEditor(null)}
                />
            </section>
        </div>, modalTarget) : null}
    </div>
}
