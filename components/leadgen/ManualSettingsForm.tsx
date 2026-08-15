"use client"

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react"
import { registerWorkspaceAutosaveFlusher, runWorkspaceMutation } from "@/lib/workspace-mutations"

type DirtyCounts = Record<string, number>
type ControlValue = { name: string; values: string[] }
type SectionDirtyOverride = { section: string; count: number }
type SettingsSaveState = "idle" | "dirty" | "saving" | "saved" | "error"

function controlValues(section: Element): ControlValue[] {
    const controls = [...section.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>("input[name], textarea[name], select[name]")]
    const grouped = new Map<string, string[]>()
    for (const control of controls) {
        const current = grouped.get(control.name) ?? []
        if (control instanceof HTMLInputElement && (control.type === "checkbox" || control.type === "radio")) {
            current.push(control.checked ? control.value || "on" : "__unchecked")
        } else if (control instanceof HTMLSelectElement && control.multiple) {
            current.push(...[...control.selectedOptions].map((option) => option.value))
        } else {
            current.push(control.value)
        }
        grouped.set(control.name, current)
    }
    return [...grouped.entries()].map(([name, values]) => ({ name, values }))
}

function valuesChanged(a: string[] = [], b: string[] = []) {
    if (a.length !== b.length) return true
    return a.some((value, index) => value !== b[index])
}

function snapshot(form: HTMLFormElement) {
    const next = new Map<string, ControlValue[]>()
    form.querySelectorAll("[data-settings-section]").forEach((section) => {
        const key = section.getAttribute("data-settings-section")
        if (key) next.set(key, controlValues(section))
    })
    return next
}

function dirtyCounts(current: Map<string, ControlValue[]>, baseline: Map<string, ControlValue[]>) {
    const counts: DirtyCounts = {}
    for (const [sectionName, currentValues] of current) {
        const baselineValues = baseline.get(sectionName) ?? []
        const currentByName = new Map(currentValues.map((item) => [item.name, item.values]))
        const baselineByName = new Map(baselineValues.map((item) => [item.name, item.values]))
        const names = new Set([...currentByName.keys(), ...baselineByName.keys()])
        counts[sectionName] = [...names].filter((name) => valuesChanged(currentByName.get(name), baselineByName.get(name))).length
    }
    return counts
}

function restoreSection(section: Element, baselineValues: ControlValue[]) {
    const valuesByName = new Map(baselineValues.map((item) => [item.name, item.values]))
    const offsets = new Map<string, number>()
    const controls = [...section.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>("input[name], textarea[name], select[name]")]
    for (const control of controls) {
        const values = valuesByName.get(control.name) ?? []
        const index = offsets.get(control.name) ?? 0
        const value = values[index] ?? ""
        offsets.set(control.name, index + 1)
        if (control instanceof HTMLInputElement && (control.type === "checkbox" || control.type === "radio")) {
            control.checked = value !== "__unchecked"
        } else {
            control.value = value
        }
        control.dispatchEvent(new Event("input", { bubbles: true }))
        control.dispatchEvent(new Event("change", { bubbles: true }))
    }
}

export function ManualSettingsForm({
    action,
    children,
    className = "mt-8 space-y-4",
}: {
    action: (formData: FormData) => void | Promise<void>
    children: ReactNode
    className?: string
}) {
    const formRef = useRef<HTMLFormElement>(null)
    const baselineRef = useRef<Map<string, ControlValue[]>>(new Map())
    const timerRef = useRef<number | null>(null)
    const savingRef = useRef(false)
    const resaveRef = useRef(false)
    const [saving, setSaving] = useState(false)

    const publishDirty = useCallback(() => {
        const form = formRef.current
        if (!form) return
        const counts = dirtyCounts(snapshot(form), baselineRef.current)
        window.dispatchEvent(new CustomEvent("betelgeze:settings-dirty", { detail: counts }))
    }, [])

    const publishSaveState = useCallback((state: SettingsSaveState, error?: string) => {
        window.dispatchEvent(new CustomEvent("betelgeze:settings-save-state", { detail: { state, error } }))
    }, [])

    const save = useCallback(async function saveSettings() {
        const form = formRef.current
        if (!form || !form.reportValidity()) return
        if (timerRef.current) {
            window.clearTimeout(timerRef.current)
            timerRef.current = null
        }
        const submitted = snapshot(form)
        if (!Object.values(dirtyCounts(submitted, baselineRef.current)).some((count) => count > 0)) return
        if (savingRef.current) {
            resaveRef.current = true
            return
        }
        savingRef.current = true
        setSaving(true)
        publishSaveState("saving")
        try {
            await runWorkspaceMutation(() => Promise.resolve(action(new FormData(form))))
            baselineRef.current = submitted
            publishDirty()
            publishSaveState("saved")
        } catch (error) {
            publishSaveState("error", error instanceof Error ? error.message : "These settings could not be saved.")
        } finally {
            savingRef.current = false
            setSaving(false)
            if (resaveRef.current) {
                resaveRef.current = false
                void saveSettings()
            }
        }
    }, [action, publishDirty, publishSaveState])

    function scheduleDirtyCheck(target?: EventTarget | null) {
        window.setTimeout(publishDirty, 0)
        publishSaveState("dirty")
        if (timerRef.current) window.clearTimeout(timerRef.current)
        const immediate = target instanceof HTMLSelectElement || target instanceof HTMLInputElement && ["checkbox", "radio", "date", "time", "number"].includes(target.type)
        if (immediate) {
            void save()
            return
        }
        timerRef.current = window.setTimeout(() => void save(), 800)
    }

    useEffect(() => {
        const form = formRef.current
        if (!form) return
        baselineRef.current = snapshot(form)
        publishDirty()
        const revert = (event: Event) => {
            const section = (event as CustomEvent<string>).detail
            const target = section ? form.querySelector(`[data-settings-section="${section}"]`) : null
            const baseline = section ? baselineRef.current.get(section) : null
            if (!target || !baseline) return
            window.dispatchEvent(new CustomEvent("betelgeze:settings-section-revert", { detail: section }))
            window.setTimeout(() => {
                restoreSection(target, baseline)
                publishDirty()
            }, 0)
        }
        window.addEventListener("betelgeze:settings-revert-request", revert)
        const unregister = registerWorkspaceAutosaveFlusher(save)
        return () => {
            window.removeEventListener("betelgeze:settings-revert-request", revert)
            unregister()
            if (timerRef.current) window.clearTimeout(timerRef.current)
        }
    }, [publishDirty, save])

    return <form
        ref={formRef}
        onSubmit={(event) => { event.preventDefault(); void save() }}
        onChange={(event) => scheduleDirtyCheck(event.target)}
        onInput={(event) => scheduleDirtyCheck(event.target)}
        onBlurCapture={() => { if (timerRef.current) void save() }}
        onClick={(event) => {
            if (event.target instanceof HTMLElement && event.target.closest("[data-settings-control]")) scheduleDirtyCheck(event.target)
        }}
        className={className}
        data-settings-saving={saving ? "true" : "false"}
        data-workspace-autosave="true"
    >
        {children}
    </form>
}

export function SettingsSectionActions({ section, label }: { section: string; label: string }) {
    const [dirtyCount, setDirtyCount] = useState(0)
    const [overrideDirtyCount, setOverrideDirtyCount] = useState<number | null>(null)
    const [saveState, setSaveState] = useState<SettingsSaveState>("idle")
    const [saveError, setSaveError] = useState<string | null>(null)
    useEffect(() => {
        const update = (event: Event) => {
            const counts = (event as CustomEvent<DirtyCounts>).detail ?? {}
            setDirtyCount(counts[section] ?? 0)
        }
        const updateOverride = (event: Event) => {
            const detail = (event as CustomEvent<SectionDirtyOverride>).detail
            if (detail?.section === section) setOverrideDirtyCount(detail.count)
        }
        const updateSaveState = (event: Event) => {
            const detail = (event as CustomEvent<{ state?: SettingsSaveState; error?: string }>).detail
            setSaveState(detail?.state ?? "idle")
            setSaveError(detail?.error ?? null)
        }
        window.addEventListener("betelgeze:settings-dirty", update)
        window.addEventListener("betelgeze:settings-section-dirty", updateOverride)
        window.addEventListener("betelgeze:settings-save-state", updateSaveState)
        return () => {
            window.removeEventListener("betelgeze:settings-dirty", update)
            window.removeEventListener("betelgeze:settings-section-dirty", updateOverride)
            window.removeEventListener("betelgeze:settings-save-state", updateSaveState)
        }
    }, [section])

    const displayDirtyCount = overrideDirtyCount ?? dirtyCount

    function revert() {
        window.dispatchEvent(new CustomEvent("betelgeze:settings-revert-request", { detail: section }))
    }

    return <div className="mt-4 flex flex-wrap items-center gap-2">
        <p aria-live="polite" title={saveError ?? undefined} className={`text-xs ${saveState === "error" ? "text-red-300" : "text-neutral-500"}`}>{saveState === "saving" ? `Saving ${label}…` : saveState === "error" ? saveError || `${label} could not save automatically` : displayDirtyCount > 0 ? `${label} will save automatically` : `${label} saved automatically`}</p>
        {saveState === "error" ? <button type="submit" className="text-xs text-red-200 underline decoration-red-500/50 underline-offset-2 hover:text-white">Retry</button> : null}
        {displayDirtyCount > 0 && <button type="button" onClick={revert} className="inline-flex min-h-10 items-center justify-center rounded-lg border border-red-400/40 px-3 text-sm font-medium leading-none text-red-200 transition hover:border-red-300 hover:text-red-100">Revert {displayDirtyCount} change{displayDirtyCount === 1 ? "" : "s"}</button>}
    </div>
}
