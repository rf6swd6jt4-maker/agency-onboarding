"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
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
import { useOnboardingSaveTask } from "@/components/onboarding/OnboardingSaveCoordinator"
import { RequestHelpLink } from "@/components/onboarding/RequestHelpLink"

type SetupBlock = Extract<OnboardingBlock, { kind: "appointment_medium" | "appointment_fields" }>
type SetupPayload = { mediums: AppointmentMedium[] } | { fields: AppointmentRequestedField[] }

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
    const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved" | "error">(satisfied ? "saved" : "idle")
    const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
    const saveQueueRef = useRef<{ version: number; payload: SetupPayload } | null>(null)
    const savePumpRef = useRef<Promise<void> | null>(null)
    const saveVersionRef = useRef(0)
    const mountedRef = useRef(true)
    const onSatisfiedRef = useRef(onSatisfied)
    const onUnsatisfiedRef = useRef(onUnsatisfied)
    const selectedFields = useMemo(() => new Map(fields.map((field) => [field.key, field.required])), [fields])

    useEffect(() => {
        onSatisfiedRef.current = onSatisfied
        onUnsatisfiedRef.current = onUnsatisfied
    }, [onSatisfied, onUnsatisfied])

    const flushSaveQueue = useCallback(() => {
        const sessionBlockId = block.sessionBlockId
        if (locked || preview || !sessionBlockId) return Promise.resolve()
        if (savePumpRef.current) return savePumpRef.current

        const pump = (async () => {
            while (saveQueueRef.current) {
                if (!navigator.onLine) {
                    if (mountedRef.current) {
                        setSaveStatus("error")
                        setError("Your changes will save when you reconnect.")
                    }
                    return
                }

                const pending = saveQueueRef.current
                saveQueueRef.current = null
                if (mountedRef.current) setSaveStatus("saving")

                let outcome: Awaited<ReturnType<typeof configureAppointmentSettingBlock>>
                try {
                    outcome = await configureAppointmentSettingBlock(
                        token,
                        sessionBlockId,
                        block.kind,
                        pending.payload,
                    )
                } catch {
                    outcome = { ok: false, error: "Could not save the appointment preferences." }
                }

                if (!outcome.ok) {
                    const newer = saveQueueRef.current as { version: number; payload: SetupPayload } | null
                    if (!newer || newer.version <= pending.version) {
                        saveQueueRef.current = pending
                        if (mountedRef.current) {
                            setSaveStatus("error")
                            setError(outcome.error)
                            onUnsatisfiedRef.current()
                        }
                        return
                    }
                    continue
                }

                if (mountedRef.current && !saveQueueRef.current && saveVersionRef.current === pending.version) {
                    setSaveStatus("saved")
                    setError(null)
                    onSatisfiedRef.current()
                }
            }
        })()

        savePumpRef.current = pump
        const release = () => {
            if (savePumpRef.current === pump) savePumpRef.current = null
        }
        void pump.then(release, release)
        return pump
    }, [block.kind, block.sessionBlockId, locked, preview, token])

    const flushPendingSave = useCallback(async () => {
        if (saveTimerRef.current) {
            clearTimeout(saveTimerRef.current)
            saveTimerRef.current = null
        }
        await flushSaveQueue()
        if (saveQueueRef.current && navigator.onLine) await flushSaveQueue()
        if (saveQueueRef.current) {
            throw new Error("Your appointment preferences have not saved yet. Check your connection and try again.")
        }
    }, [flushSaveQueue])

    useOnboardingSaveTask(
        `appointment:${block.sessionBlockId ?? block.id}`,
        flushPendingSave,
    )

    const queueSave = useCallback((payload: SetupPayload) => {
        if (locked) return
        setError(null)

        if (block.kind === "appointment_medium" && "mediums" in payload && payload.mediums.length === 0) {
            onUnsatisfiedRef.current()
            if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
            saveQueueRef.current = null
            setSaveStatus("idle")
            setError("Choose at least one appointment option.")
            return
        }

        // Required-block gating is optimistic. Continue performs an authoritative
        // flush before completing the step, so clients never have to wait for a
        // debounce merely to press the button.
        onSatisfiedRef.current()

        if (preview || !block.sessionBlockId) {
            setSaveStatus("saved")
            return
        }

        const version = saveVersionRef.current + 1
        saveVersionRef.current = version
        saveQueueRef.current = { version, payload }
        setSaveStatus("saving")
        if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
        saveTimerRef.current = setTimeout(() => {
            saveTimerRef.current = null
            void flushSaveQueue()
        }, 500)
    }, [block.kind, block.sessionBlockId, flushSaveQueue, locked, preview])

    useEffect(() => {
        mountedRef.current = true
        const retry = () => void flushSaveQueue()
        window.addEventListener("online", retry)
        return () => {
            mountedRef.current = false
            if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
            window.removeEventListener("online", retry)
        }
    }, [flushSaveQueue])

    useEffect(() => {
        if (locked || satisfied || block.kind !== "appointment_fields") return
        const timer = window.setTimeout(() => queueSave({ fields }), 0)
        // The default field selection is a real configuration and should save on first render.
        return () => window.clearTimeout(timer)
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    function toggleMedium(medium: AppointmentMedium) {
        if (locked) return
        const next = mediums.includes(medium) ? mediums.filter((item) => item !== medium) : [...mediums, medium]
        setMediums(next)
        queueSave({ mediums: next })
    }

    function setField(key: AppointmentFieldKey, value: "off" | "optional" | "required") {
        if (locked || block.kind !== "appointment_fields") return
        const alreadySelected = selectedFields.has(key)
        if (value !== "off" && !alreadySelected && fields.length >= block.maximumFields) {
            setError(`Choose up to ${block.maximumFields} extra fields.`)
            return
        }
        const next = value === "off"
            ? fields.filter((field) => field.key !== key)
            : [...fields.filter((field) => field.key !== key), { key, required: value === "required" }]
        setFields(next)
        queueSave({ fields: next })
    }

    return <div className="rounded-2xl border border-black/10 bg-[var(--onboarding-page)] p-4 sm:p-5">
        <h2 className="font-semibold text-[var(--onboarding-text)]">{block.title}</h2>
        {block.description ? <p className="mt-2 text-sm leading-6 text-[var(--onboarding-muted)]">{block.description}</p> : null}

        {block.kind === "appointment_medium" ? <fieldset disabled={locked} className="mt-4 grid gap-3 sm:mt-5 sm:grid-cols-3">
            <legend className="sr-only">Appointment options</legend>
            {APPOINTMENT_MEDIUM_OPTIONS.filter((option) => block.options.includes(option.key)).map((option) => {
                const checked = mediums.includes(option.key)
                return <label key={option.key} className={`flex cursor-pointer gap-3 rounded-xl border p-3.5 transition sm:p-4 ${checked ? "border-[var(--onboarding-primary)] bg-[var(--onboarding-surface)]" : "border-black/10 bg-[var(--onboarding-surface)]"}`}><input type="checkbox" checked={checked} onChange={() => toggleMedium(option.key)} className="mt-0.5 h-5 w-5 shrink-0 accent-[var(--onboarding-primary)]" /><span><span className="block text-sm font-semibold text-[var(--onboarding-text)]">{option.label}</span><span className="mt-1 block text-xs leading-5 text-[var(--onboarding-muted)]">{option.description}</span></span></label>
            })}
        </fieldset> : <fieldset disabled={locked} className="mt-4 space-y-2 sm:mt-5">
            <legend className="sr-only">Extra appointment information</legend>
            <div className="rounded-xl border border-black/10 bg-[var(--onboarding-surface)] px-3.5 py-3 text-sm leading-5 text-[var(--onboarding-text)] sm:px-4"><span className="font-semibold">Always included:</span> Lead name, appointment date, and appointment time</div>
            {APPOINTMENT_FIELD_OPTIONS.filter((option) => block.options.includes(option.key)).map((option) => {
                const selected = selectedFields.get(option.key)
                return <label key={option.key} className="grid gap-3 rounded-xl border border-black/10 bg-[var(--onboarding-surface)] px-3.5 py-3 sm:grid-cols-[minmax(0,1fr)_9rem] sm:items-center sm:gap-2 sm:px-4"><span><span className="block text-sm font-semibold text-[var(--onboarding-text)]">{option.label}</span><span className="mt-1 block text-xs leading-5 text-[var(--onboarding-muted)]">{option.description}</span></span><select aria-label={`${option.label} requirement`} value={selected === undefined ? "off" : selected ? "required" : "optional"} onChange={(event) => setField(option.key, event.target.value as "off" | "optional" | "required")} className="h-12 w-full rounded-lg border border-black/15 bg-[var(--onboarding-page)] px-3 text-base text-[var(--onboarding-text)] sm:h-10 sm:text-sm"><option value="off">Not included</option><option value="optional">Optional</option><option value="required">Required</option></select></label>
            })}
            <p className="pt-1 text-xs text-[var(--onboarding-muted)]">Choose up to {block.maximumFields} extra fields.</p>
        </fieldset>}

        {error ? <p role="alert" className="mt-3 text-left text-sm text-red-700">{error} <RequestHelpLink />.</p> : null}
        {!locked ? <p aria-live="polite" className="mt-3 text-xs text-[var(--onboarding-muted)]">{saveStatus === "saving" ? "Saving changes…" : saveStatus === "saved" ? "Changes saved" : saveStatus === "error" ? "Changes not saved yet" : ""}</p> : null}
    </div>
}
