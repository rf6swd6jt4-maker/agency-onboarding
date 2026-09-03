"use client"

import { useMemo, useState, useTransition } from "react"
import { configureAppointmentSettingBlock } from "@/app/onboarding/session/[token]/actions"
import {
    APPOINTMENT_FIELD_OPTIONS,
    APPOINTMENT_MEDIUM_OPTIONS,
    normalizeAppointmentMediums,
    normalizeAppointmentRequestedFields,
    type AppointmentFieldKey,
    type AppointmentMedium,
    type AppointmentRequestedField,
} from "@/lib/appointment-setting"
import type { OnboardingBlock } from "@/lib/onboarding/block-definition"

type SetupBlock = Extract<OnboardingBlock, { kind: "appointment_medium" | "appointment_fields" }>

function initialMediums(response: unknown): AppointmentMedium[] {
    if (!response || typeof response !== "object" || Array.isArray(response)) return []
    return normalizeAppointmentMediums((response as { mediums?: unknown }).mediums)
}

function initialFields(response: unknown, maximum: number): AppointmentRequestedField[] {
    if (!response || typeof response !== "object" || Array.isArray(response)) return [{ key: "phone", required: true }]
    return normalizeAppointmentRequestedFields((response as { fields?: unknown }).fields, maximum)
}

export function AppointmentSetupBlock({
    block,
    token,
    initialResponse,
    locked,
    preview,
    satisfied,
    onSatisfied,
    onUnsatisfied,
}: {
    block: SetupBlock & { sessionBlockId?: string }
    token: string
    initialResponse?: unknown
    locked: boolean
    preview: boolean
    satisfied: boolean
    onSatisfied: () => void
    onUnsatisfied: () => void
}) {
    const [mediums, setMediums] = useState<AppointmentMedium[]>(() => initialMediums(initialResponse))
    const [fields, setFields] = useState<AppointmentRequestedField[]>(() => block.kind === "appointment_fields" ? initialFields(initialResponse, block.maximumFields) : [])
    const [error, setError] = useState<string | null>(null)
    const [saved, setSaved] = useState(satisfied)
    const [pending, startTransition] = useTransition()
    const selectedFields = useMemo(() => new Map(fields.map((field) => [field.key, field.required])), [fields])

    function markDirty() {
        setSaved(false)
        setError(null)
        onUnsatisfied()
    }

    function toggleMedium(medium: AppointmentMedium) {
        if (locked) return
        markDirty()
        setMediums((current) => current.includes(medium) ? current.filter((item) => item !== medium) : [...current, medium])
    }

    function setField(key: AppointmentFieldKey, value: "off" | "optional" | "required") {
        if (locked || block.kind !== "appointment_fields") return
        const alreadySelected = selectedFields.has(key)
        if (value !== "off" && !alreadySelected && fields.length >= block.maximumFields) {
            setError(`Choose up to ${block.maximumFields} extra fields.`)
            return
        }
        markDirty()
        setFields((current) => value === "off"
            ? current.filter((field) => field.key !== key)
            : [...current.filter((field) => field.key !== key), { key, required: value === "required" }])
    }

    function save() {
        if (block.kind === "appointment_medium" && mediums.length === 0) {
            setError("Choose at least one appointment option.")
            return
        }
        if (preview || !block.sessionBlockId) {
            setSaved(true)
            onSatisfied()
            return
        }
        startTransition(async () => {
            const outcome = await configureAppointmentSettingBlock(token, block.sessionBlockId!, block.kind, block.kind === "appointment_medium" ? { mediums } : { fields })
            if (!outcome.ok) {
                setError(outcome.error)
                return
            }
            setSaved(true)
            onSatisfied()
        })
    }

    return <div className="rounded-2xl border border-black/10 bg-[var(--onboarding-page)] p-5">
        <h2 className="font-semibold text-[var(--onboarding-text)]">{block.title}</h2>
        {block.description ? <p className="mt-2 text-sm leading-6 text-[var(--onboarding-muted)]">{block.description}</p> : null}

        {block.kind === "appointment_medium" ? <fieldset disabled={locked || pending} className="mt-5 grid gap-3 sm:grid-cols-3">
            <legend className="sr-only">Appointment options</legend>
            {APPOINTMENT_MEDIUM_OPTIONS.filter((option) => block.options.includes(option.key)).map((option) => {
                const checked = mediums.includes(option.key)
                return <label key={option.key} className={`flex cursor-pointer gap-3 rounded-xl border p-4 transition ${checked ? "border-[var(--onboarding-primary)] bg-[var(--onboarding-surface)]" : "border-black/10 bg-[var(--onboarding-surface)]"}`}><input type="checkbox" checked={checked} onChange={() => toggleMedium(option.key)} className="mt-1 h-4 w-4 accent-[var(--onboarding-primary)]" /><span><span className="block text-sm font-semibold text-[var(--onboarding-text)]">{option.label}</span><span className="mt-1 block text-xs leading-5 text-[var(--onboarding-muted)]">{option.description}</span></span></label>
            })}
        </fieldset> : <fieldset disabled={locked || pending} className="mt-5 space-y-2">
            <legend className="sr-only">Extra appointment information</legend>
            <div className="rounded-xl border border-black/10 bg-[var(--onboarding-surface)] px-4 py-3 text-sm text-[var(--onboarding-text)]"><span className="font-semibold">Always included:</span> Lead name, appointment date, and appointment time</div>
            {APPOINTMENT_FIELD_OPTIONS.filter((option) => block.options.includes(option.key)).map((option) => {
                const selected = selectedFields.get(option.key)
                return <label key={option.key} className="grid gap-2 rounded-xl border border-black/10 bg-[var(--onboarding-surface)] px-4 py-3 sm:grid-cols-[minmax(0,1fr)_8rem] sm:items-center"><span><span className="block text-sm font-semibold text-[var(--onboarding-text)]">{option.label}</span><span className="mt-1 block text-xs leading-5 text-[var(--onboarding-muted)]">{option.description}</span></span><select aria-label={`${option.label} requirement`} value={selected === undefined ? "off" : selected ? "required" : "optional"} onChange={(event) => setField(option.key, event.target.value as "off" | "optional" | "required")} className="h-10 rounded-lg border border-black/15 bg-[var(--onboarding-page)] px-3 text-sm text-[var(--onboarding-text)]"><option value="off">Not included</option><option value="optional">Optional</option><option value="required">Required</option></select></label>
            })}
            <p className="pt-1 text-xs text-[var(--onboarding-muted)]">Choose up to {block.maximumFields} extra fields.</p>
        </fieldset>}

        {error ? <p role="alert" className="mt-3 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</p> : null}
        {!locked ? <button type="button" disabled={pending} onClick={save} className="mt-5 inline-flex min-h-12 items-center justify-center rounded-xl bg-[var(--onboarding-primary)] px-5 py-3 font-medium text-white disabled:opacity-60">{pending ? "Saving…" : saved ? "Saved ✓" : "Save choices"}</button> : null}
    </div>
}
