"use client"

import { useEffect, useMemo, useRef, useState, useTransition, type MouseEvent } from "react"
import { saveAgencyBranding } from "@/app/[workspaceSlug]/settings/branding-actions"
import { publishVisualThemeDraft } from "@/app/[workspaceSlug]/onboarding-builder/visual-actions"
import { AnchoredPopup } from "@/components/ui"
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
    const [assignmentEditor, setAssignmentEditor] = useState<{ slot: OnboardingThemeSlot; anchor: HTMLElement } | null>(null)
    const latestRef = useRef(theme)
    const lastSavedRef = useRef(themeKey(initialTheme))
    const timerRef = useRef<number | null>(null)
    const saveQueueRef = useRef(Promise.resolve())
    const warnings = useMemo(() => onboardingThemeWarnings(theme), [theme])

    useEffect(() => { latestRef.current = theme }, [theme])

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

    function addSwatch() {
        const id = crypto.randomUUID()
        setTheme((current) => ({ ...current, swatches: [...current.swatches, { id, name: "New colour", hex: "#64748B", hidden: false }] }))
    }

    function openAssignmentEditor(event: MouseEvent<HTMLButtonElement>, slot: OnboardingThemeSlot) {
        setAssignmentEditor({ slot, anchor: event.currentTarget })
    }

    function assignSwatch(slot: OnboardingThemeSlot, swatchId: string) {
        setTheme((current) => ({ ...current, assignments: { ...current.assignments, [slot]: swatchId } }))
    }

    const visibleSwatches = theme.swatches.filter((swatch) => !swatch.hidden)
    const hiddenSwatches = theme.swatches.filter((swatch) => swatch.hidden)

    const editedSlot = assignmentEditor?.slot ?? null
    const editedAssignment = editedSlot ? theme.swatches.find((swatch) => swatch.id === theme.assignments[editedSlot]) : null

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
                            onClick={(event) => openAssignmentEditor(event, slot)}
                            className={`flex min-w-0 items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-neutral-900 disabled:cursor-default disabled:opacity-50 ${index > 0 ? "border-t border-neutral-800" : ""} ${index === 1 ? "sm:border-t-0" : ""} ${index % 2 === 1 ? "sm:border-l sm:border-neutral-800" : ""}`}
                        >
                            <span aria-hidden="true" className="h-7 w-7 shrink-0 rounded-md border border-white/10" style={{ backgroundColor: normalizeHexColour(assigned?.hex) ?? "#000000" }} />
                            <span className="min-w-0 flex-1"><span className="block truncate text-sm text-neutral-200">{ONBOARDING_THEME_SLOT_LABELS[slot]}</span><span className="mt-0.5 block truncate text-xs text-neutral-500">{assigned?.name ?? "Default colour"}</span></span>
                            <svg aria-hidden="true" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="h-4 w-4 shrink-0 text-neutral-600"><path d="m6 3 5 5-5 5" /></svg>
                        </button>
                    })}
                </div>
            </section>
            {warnings.length ? <section className="rounded-xl border border-yellow-500/30 bg-yellow-500/10 px-4 py-3 text-sm text-yellow-100"><h3 className="font-medium">Contrast warnings</h3><ul className="mt-2 list-disc space-y-1 pl-5 text-xs leading-5 text-yellow-100/80">{warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul><p className="mt-2 text-xs text-yellow-100/70">Warnings do not block saving.</p></section> : null}
            <div className="flex items-center justify-between gap-3"><div aria-live="polite" className="min-h-5 text-xs text-neutral-500">{saveState === "saving" ? "Saving style draft…" : saveState === "saved" ? published ? "Style published" : "Unpublished style draft saved" : saveState === "error" ? error : schemaReady ? "Unpublished style draft" : "Read-only compatibility view"}</div><button type="button" disabled={!schemaReady || publishPending || published} onClick={() => startPublish(async () => { const outcome = await publishVisualThemeDraft(workspaceSlug, latestRef.current); if (!outcome.ok) setError(outcome.error); else setPublished(true) })} className="h-10 rounded-lg bg-white px-4 text-sm font-medium text-black disabled:opacity-30">{publishPending ? "Publishing…" : "Publish style"}</button></div>
        {assignmentEditor && editedSlot ? <AnchoredPopup anchor={assignmentEditor.anchor} align="end" role="dialog" onDismiss={() => setAssignmentEditor(null)} className="w-[min(25rem,calc(100vw-1rem))] rounded-xl border border-neutral-700 bg-neutral-950 shadow-2xl shadow-black/60">
            <div className="flex items-start justify-between gap-3 border-b border-neutral-800 px-3 py-3"><div><p className="text-sm font-medium text-white">{ONBOARDING_THEME_SLOT_LABELS[editedSlot]}</p><p className="mt-0.5 text-xs text-neutral-500">Choose from your client-facing palette.</p></div><button type="button" onClick={() => setAssignmentEditor(null)} className="shrink-0 px-1 text-xs text-neutral-500 hover:text-white">Close</button></div>
            <div className="p-2">
                <div className="flex items-center justify-between px-1 pb-2"><p className="text-xs font-medium text-neutral-400">Colour palette</p><button type="button" onClick={addSwatch} className="text-xs text-neutral-400 underline underline-offset-4 hover:text-white">Add colour</button></div>
                <div className="divide-y divide-neutral-800 overflow-hidden rounded-lg border border-neutral-800 bg-black">
                    {visibleSwatches.map((swatch) => {
                        const selected = theme.assignments[editedSlot] === swatch.id
                        return <div key={swatch.id} className="grid grid-cols-[2rem_minmax(0,1fr)_5.75rem_2rem_2rem] items-center gap-1.5 p-1.5">
                            <input aria-label={`${swatch.name} colour`} type="color" value={normalizeHexColour(swatch.hex) ?? "#000000"} onChange={(event) => updateSwatch(swatch.id, { hex: event.target.value.toUpperCase() })} className="h-8 w-8 cursor-pointer rounded-md border border-neutral-700 bg-transparent p-0.5" />
                            <input aria-label="Colour name" value={swatch.name} onChange={(event) => updateSwatch(swatch.id, { name: event.target.value })} maxLength={80} className="h-8 min-w-0 rounded-md border border-transparent bg-transparent px-2 text-xs text-neutral-200 hover:border-neutral-800 focus:border-neutral-700 focus:outline-none" />
                            <input aria-label={`${swatch.name} hex`} value={swatch.hex} onChange={(event) => updateSwatch(swatch.id, { hex: event.target.value.toUpperCase() })} maxLength={7} className="h-8 min-w-0 rounded-md border border-transparent bg-transparent px-2 font-mono text-xs uppercase text-neutral-400 hover:border-neutral-800 focus:border-neutral-700 focus:outline-none" />
                            <button type="button" aria-label={`Assign ${swatch.name} to ${ONBOARDING_THEME_SLOT_LABELS[editedSlot]}`} aria-pressed={selected} onClick={() => assignSwatch(editedSlot, swatch.id)} className={`flex h-8 w-8 items-center justify-center rounded-md text-sm ${selected ? "bg-white text-black" : "text-neutral-600 hover:bg-neutral-900 hover:text-white"}`}>{selected ? "✓" : ""}</button>
                            <button type="button" aria-label={`Hide ${swatch.name}`} title="Hide colour" onClick={() => updateSwatch(swatch.id, { hidden: true })} className="flex h-8 w-8 items-center justify-center rounded-md text-xs text-neutral-600 hover:bg-neutral-900 hover:text-white">×</button>
                        </div>
                    })}
                    {!visibleSwatches.length ? <p className="p-3 text-xs text-neutral-500">Restore a hidden colour or add a new one.</p> : null}
                </div>
                {hiddenSwatches.length ? <details className="mt-2 px-1"><summary className="cursor-pointer text-xs text-neutral-500">Hidden colours ({hiddenSwatches.length})</summary><div className="mt-2 space-y-1">{hiddenSwatches.map((swatch) => <div key={swatch.id} className="flex items-center gap-2 rounded-md px-1 py-1"><span className="h-5 w-5 rounded border border-neutral-700" style={{ backgroundColor: normalizeHexColour(swatch.hex) ?? "#000000" }} /><span className="min-w-0 flex-1 truncate text-xs text-neutral-400">{swatch.name} · {swatch.hex}</span><button type="button" onClick={() => updateSwatch(swatch.id, { hidden: false })} className="text-xs text-neutral-400 underline underline-offset-4 hover:text-white">Restore</button></div>)}</div></details> : null}
            </div>
            <div className="flex items-center gap-2 border-t border-neutral-800 px-3 py-2.5"><span className="h-5 w-5 shrink-0 rounded border border-white/10" style={{ backgroundColor: normalizeHexColour(editedAssignment?.hex) ?? "#000000" }} /><span className="text-xs text-neutral-500">Assigned colour</span><span className="min-w-0 flex-1 truncate text-right text-xs text-neutral-200">{editedAssignment?.name ?? "Default colour"}</span></div>
        </AnchoredPopup> : null}
    </div>
}
