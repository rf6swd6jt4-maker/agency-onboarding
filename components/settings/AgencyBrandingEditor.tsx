"use client"

import { useEffect, useMemo, useRef, useState, useTransition } from "react"
import { createPortal } from "react-dom"
import { saveAgencyBranding } from "@/app/[workspaceSlug]/settings/branding-actions"
import { publishVisualThemeDraft } from "@/app/[workspaceSlug]/onboarding-builder/visual-actions"
import { ColourStyleEditor } from "@/components/settings/ColourStyleEditor"
import { ONBOARDING_THEME_SLOTS, type OnboardingBrandSwatch, type OnboardingThemeDefinition, type OnboardingThemeSlot } from "@/lib/onboarding/configuration-types"
import { normalizeHexColour, ONBOARDING_THEME_SLOT_LABELS, onboardingThemeWarnings } from "@/lib/onboarding/theme"
import { runWorkspaceMutation } from "@/lib/workspace-mutations"
import { WorkspaceActionButton } from "@/components/workspace/WorkspaceActionButton"

function themeKey(theme: OnboardingThemeDefinition) {
    return JSON.stringify({ swatches: theme.swatches, assignments: theme.assignments })
}

export function AgencyBrandingEditor({ workspaceSlug, initialTheme, schemaReady, faviconSrc, uploadFavicon }: { workspaceSlug: string; initialTheme: OnboardingThemeDefinition; schemaReady: boolean; faviconSrc: string | null; uploadFavicon: (formData: FormData) => Promise<void> }) {
    const [theme, setTheme] = useState(initialTheme)
    const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle")
    const [error, setError] = useState<string | null>(null)
    const [publishPending, startPublish] = useTransition()
    const [published, setPublished] = useState(false)
    const [assignmentEditor, setAssignmentEditor] = useState<{ slot: OnboardingThemeSlot } | null>(null)
    const latestRef = useRef(theme)
    const lastSavedRef = useRef(themeKey(initialTheme))
    const timerRef = useRef<number | null>(null)
    const saveQueueRef = useRef(Promise.resolve())
    const warnings = useMemo(() => onboardingThemeWarnings(theme), [theme])

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
                if (themeKey(latestRef.current) === payloadKey) { setSaveState("saved"); setPublished(false) }
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

    const editedSlot = assignmentEditor?.slot ?? null
    const editedAssignment = editedSlot ? theme.swatches.find((swatch) => swatch.id === theme.assignments[editedSlot]) : null
    const modalTarget = typeof window !== "undefined" ? (window.parent !== window ? window.parent.document.body : document.body) : null

    return <div className="space-y-5">
            {!schemaReady ? <p className="rounded-xl border border-yellow-500/30 bg-yellow-500/10 px-4 py-3 text-sm text-yellow-100">Theme controls are read-only until the onboarding configuration schema is deployed.</p> : null}
            <section className="rounded-2xl border border-neutral-800 bg-neutral-900 p-4 sm:p-5">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex min-w-0 items-center gap-4">
                        <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-neutral-700 bg-black p-2">
                            {/* Signed workspace-logo URLs are already resized by the token-scoped favicon endpoint. */}
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={faviconSrc ?? "/icon.svg"} alt="Client browser favicon preview" className="h-full w-full object-contain" />
                        </div>
                        <div><h3 className="font-semibold">Client-facing favicon</h3><p className="mt-1 max-w-xl text-sm leading-6 text-neutral-500">Your workspace logo appears in browser tabs for onboarding and the client portal. Uploading here also updates the workspace logo.</p></div>
                    </div>
                    <form action={uploadFavicon} data-workspace-mutation="background" className="flex shrink-0 items-center gap-2">
                        <input name="logo" required type="file" accept="image/png,image/jpeg,image/gif,image/webp" aria-label="Client-facing favicon image" className="min-w-0 max-w-56 text-xs text-neutral-400 file:mr-2 file:rounded-lg file:border-0 file:bg-neutral-800 file:px-3 file:py-2 file:text-sm file:text-white" />
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
                            <svg aria-hidden="true" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className={`h-4 w-4 shrink-0 text-neutral-600 transition-transform ${assignmentEditor?.slot === slot ? "rotate-180" : ""}`}><path d="m3 6 5 5 5-5" /></svg>
                        </button>
                    })}
                </div>
            </section>
            {warnings.length ? <section className="rounded-xl border border-yellow-500/30 bg-yellow-500/10 px-4 py-3 text-sm text-yellow-100"><h3 className="font-medium">Contrast warnings</h3><ul className="mt-2 list-disc space-y-1 pl-5 text-xs leading-5 text-yellow-100/80">{warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul><p className="mt-2 text-xs text-yellow-100/70">Warnings do not block saving.</p></section> : null}
            <div className="flex items-center justify-between gap-3"><div aria-live="polite" className="min-h-5 text-xs text-neutral-500">{saveState === "saving" ? "Saving style draft…" : saveState === "saved" ? published ? "Style published" : "Unpublished style draft saved" : saveState === "error" ? error : schemaReady ? "Unpublished style draft" : "Read-only compatibility view"}</div><button type="button" disabled={!schemaReady || publishPending || published} onClick={() => startPublish(async () => { const outcome = await publishVisualThemeDraft(workspaceSlug, latestRef.current); if (!outcome.ok) setError(outcome.error); else setPublished(true) })} className="h-10 rounded-lg bg-white px-4 text-sm font-medium text-black disabled:opacity-30">{publishPending ? "Publishing…" : "Publish style"}</button></div>
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
