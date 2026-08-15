"use client"

import { useEffect, useRef, useState, type ReactNode } from "react"
import { useRouter } from "next/navigation"

type DirtyCounts = Record<string, number>
type ControlValue = { name: string; values: string[] }
type SectionDirtyOverride = { section: string; count: number }

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
    const router = useRouter()
    const formRef = useRef<HTMLFormElement>(null)
    const baselineRef = useRef<Map<string, ControlValue[]>>(new Map())
    const [saving, setSaving] = useState(false)

    function publishDirty() {
        const form = formRef.current
        if (!form) return
        const counts = dirtyCounts(snapshot(form), baselineRef.current)
        window.dispatchEvent(new CustomEvent("betelgeze:settings-dirty", { detail: counts }))
    }

    function scheduleDirtyCheck() {
        window.setTimeout(publishDirty, 0)
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
        return () => window.removeEventListener("betelgeze:settings-revert-request", revert)
    }, [])

    return <form
        ref={formRef}
        action={async (formData) => {
            setSaving(true)
            try {
                await action(formData)
                if (formRef.current) baselineRef.current = snapshot(formRef.current)
                publishDirty()
                router.refresh()
            } finally {
                setSaving(false)
            }
        }}
        onChange={scheduleDirtyCheck}
        onInput={scheduleDirtyCheck}
        onClick={(event) => {
            if (event.target instanceof HTMLElement && event.target.closest("[data-settings-control]")) scheduleDirtyCheck()
        }}
        className={className}
        data-settings-saving={saving ? "true" : "false"}
    >
        {children}
    </form>
}

export function SettingsSectionActions({ section, label }: { section: string; label: string }) {
    const [dirtyCount, setDirtyCount] = useState(0)
    const [overrideDirtyCount, setOverrideDirtyCount] = useState<number | null>(null)
    useEffect(() => {
        const update = (event: Event) => {
            const counts = (event as CustomEvent<DirtyCounts>).detail ?? {}
            setDirtyCount(counts[section] ?? 0)
        }
        const updateOverride = (event: Event) => {
            const detail = (event as CustomEvent<SectionDirtyOverride>).detail
            if (detail?.section === section) setOverrideDirtyCount(detail.count)
        }
        window.addEventListener("betelgeze:settings-dirty", update)
        window.addEventListener("betelgeze:settings-section-dirty", updateOverride)
        return () => {
            window.removeEventListener("betelgeze:settings-dirty", update)
            window.removeEventListener("betelgeze:settings-section-dirty", updateOverride)
        }
    }, [section])

    const displayDirtyCount = overrideDirtyCount ?? dirtyCount

    function revert() {
        window.dispatchEvent(new CustomEvent("betelgeze:settings-revert-request", { detail: section }))
    }

    return <div className="mt-4 flex flex-wrap items-center gap-2">
        <button type="submit" className="inline-flex min-h-10 items-center justify-center rounded-lg bg-white px-4 text-sm font-medium leading-none text-black transition hover:bg-neutral-200">Save {label}</button>
        {displayDirtyCount > 0 && <button type="button" onClick={revert} className="inline-flex min-h-10 items-center justify-center rounded-lg border border-red-400/40 px-3 text-sm font-medium leading-none text-red-200 transition hover:border-red-300 hover:text-red-100">Revert {displayDirtyCount} change{displayDirtyCount === 1 ? "" : "s"}</button>}
    </div>
}
