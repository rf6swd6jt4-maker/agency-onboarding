"use client"

import { useEffect, useMemo, useRef, useState, useTransition } from "react"
import { saveAgencyBranding } from "@/app/[workspaceSlug]/settings/branding-actions"
import { publishVisualThemeDraft } from "@/app/[workspaceSlug]/onboarding-builder/visual-actions"
import { OnboardingThemeProvider } from "@/components/onboarding/OnboardingThemeProvider"
import { ONBOARDING_THEME_SLOTS, type OnboardingBrandSwatch, type OnboardingThemeDefinition } from "@/lib/onboarding/configuration-types"
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

    const visibleSwatches = theme.swatches.filter((swatch) => !swatch.hidden)
    const hiddenSwatches = theme.swatches.filter((swatch) => swatch.hidden)

    return <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(18rem,25rem)]">
        <div className="space-y-5">
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
                <div className="flex items-start justify-between gap-4"><div><h3 className="font-semibold">Colour palette</h3><p className="mt-1 text-sm leading-6 text-neutral-500">Name reusable colours, then assign them to the six client-facing roles.</p></div><button type="button" disabled={!schemaReady} onClick={addSwatch} className="shrink-0 rounded-lg border border-neutral-700 px-3 py-2 text-sm text-neutral-200 disabled:opacity-30">Add colour</button></div>
                <div className="mt-4 divide-y divide-neutral-800 overflow-hidden rounded-xl border border-neutral-800 bg-black">
                    {visibleSwatches.map((swatch) => <div key={swatch.id} className="grid gap-2 p-3 sm:grid-cols-[2.75rem_minmax(0,1fr)_8rem_auto] sm:items-center"><input aria-label={`${swatch.name} colour`} type="color" value={normalizeHexColour(swatch.hex) ?? "#000000"} disabled={!schemaReady} onChange={(event) => updateSwatch(swatch.id, { hex: event.target.value.toUpperCase() })} className="h-10 w-11 cursor-pointer rounded border border-neutral-700 bg-transparent p-1" /><input aria-label="Colour name" value={swatch.name} disabled={!schemaReady} onChange={(event) => updateSwatch(swatch.id, { name: event.target.value })} maxLength={80} className="h-10 rounded-lg border border-neutral-700 bg-neutral-950 px-3 text-sm text-white" /><input aria-label={`${swatch.name} hex`} value={swatch.hex} disabled={!schemaReady} onChange={(event) => updateSwatch(swatch.id, { hex: event.target.value.toUpperCase() })} maxLength={7} className="h-10 rounded-lg border border-neutral-700 bg-neutral-950 px-3 font-mono text-sm uppercase text-white" /><button type="button" disabled={!schemaReady} onClick={() => updateSwatch(swatch.id, { hidden: true })} className="h-10 px-2 text-xs text-neutral-500 hover:text-white disabled:opacity-30">Hide</button></div>)}
                    {!visibleSwatches.length ? <p className="p-4 text-sm text-neutral-500">All palette colours are hidden. Restore one below or add a colour.</p> : null}
                </div>
                {hiddenSwatches.length ? <details className="mt-3 rounded-lg border border-neutral-800 bg-black/40 p-3"><summary className="cursor-pointer text-sm text-neutral-400">Hidden colours ({hiddenSwatches.length})</summary><div className="mt-2 space-y-2">{hiddenSwatches.map((swatch) => <div key={swatch.id} className="flex items-center gap-2"><span className="h-5 w-5 rounded border border-neutral-700" style={{ backgroundColor: swatch.hex }} /><span className="min-w-0 flex-1 truncate text-sm text-neutral-300">{swatch.name} · {swatch.hex}</span><button type="button" disabled={!schemaReady} onClick={() => updateSwatch(swatch.id, { hidden: false })} className="text-xs text-neutral-400 underline underline-offset-4">Restore</button></div>)}</div></details> : null}
            </section>
            <section className="rounded-2xl border border-neutral-800 bg-neutral-900 p-4 sm:p-5"><h3 className="font-semibold">Semantic assignments</h3><p className="mt-1 text-sm leading-6 text-neutral-500">These roles are shared by onboarding and the client portal.</p><div className="mt-4 grid gap-3 sm:grid-cols-2">{ONBOARDING_THEME_SLOTS.map((slot) => { const assigned = theme.swatches.find((swatch) => swatch.id === theme.assignments[slot]); const options = assigned?.hidden ? [assigned, ...visibleSwatches] : visibleSwatches; return <label key={slot} className="block text-sm text-neutral-300">{ONBOARDING_THEME_SLOT_LABELS[slot]}<select value={theme.assignments[slot]} disabled={!schemaReady} onChange={(event) => setTheme((current) => ({ ...current, assignments: { ...current.assignments, [slot]: event.target.value } }))} className="mt-2 h-11 w-full rounded-lg border border-neutral-700 bg-black px-3 text-white">{options.map((swatch) => <option key={swatch.id} value={swatch.id}>{swatch.name}{swatch.hidden ? " (hidden)" : ""}</option>)}</select></label>})}</div></section>
            {warnings.length ? <section className="rounded-xl border border-yellow-500/30 bg-yellow-500/10 px-4 py-3 text-sm text-yellow-100"><h3 className="font-medium">Contrast warnings</h3><ul className="mt-2 list-disc space-y-1 pl-5 text-xs leading-5 text-yellow-100/80">{warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul><p className="mt-2 text-xs text-yellow-100/70">Warnings do not block saving.</p></section> : null}
            <div className="flex items-center justify-between gap-3"><div aria-live="polite" className="min-h-5 text-xs text-neutral-500">{saveState === "saving" ? "Saving style draft…" : saveState === "saved" ? published ? "Style published" : "Unpublished style draft saved" : saveState === "error" ? error : schemaReady ? "Unpublished style draft" : "Read-only compatibility view"}</div><button type="button" disabled={!schemaReady || publishPending || published} onClick={() => startPublish(async () => { const outcome = await publishVisualThemeDraft(workspaceSlug, latestRef.current); if (!outcome.ok) setError(outcome.error); else setPublished(true) })} className="h-10 rounded-lg bg-white px-4 text-sm font-medium text-black disabled:opacity-30">{publishPending ? "Publishing…" : "Publish style"}</button></div>
        </div>
        <OnboardingThemeProvider theme={theme} className="xl:sticky xl:top-5 xl:self-start"><section className="overflow-hidden rounded-2xl border border-neutral-700 bg-[var(--onboarding-page)] p-4 text-[var(--onboarding-text)] shadow-2xl shadow-black/30"><p className="text-xs font-semibold uppercase tracking-wide text-[var(--onboarding-primary)]">Live colour preview</p><article className="mt-4 rounded-xl border border-black/10 bg-[var(--onboarding-surface)] p-4"><p className="text-sm font-semibold">Tell us about your business</p><p className="mt-2 text-sm leading-6 text-[var(--onboarding-muted)]">This sample uses the same semantic colours as the onboarding renderer.</p><div className="mt-4 h-2 overflow-hidden rounded-full bg-black/10"><div className="h-full w-1/2 rounded-full bg-[var(--onboarding-accent)]" /></div><button type="button" className="mt-5 w-full rounded-lg bg-[var(--onboarding-primary)] px-4 py-3 text-sm font-medium text-white">Save and continue</button></article></section></OnboardingThemeProvider>
    </div>
}
