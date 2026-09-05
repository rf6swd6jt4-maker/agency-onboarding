"use client"

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react"
import { saveCalendarBlockResponse } from "@/app/onboarding/session/[token]/actions"
import { useOnboardingSaveTask } from "@/components/onboarding/OnboardingSaveCoordinator"
import type { CalendarBlock } from "@/lib/onboarding/block-definition"
import { formatCalendarResponse, formatCalendarSelection, normalizeCalendarResponse } from "@/lib/onboarding/calendar"
import { RequestHelpLink } from "@/components/onboarding/RequestHelpLink"

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]

function dateKey(year: number, month: number, day: number) {
    return `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`
}

function monthDays(monthKey: string) {
    const [year, monthNumber] = monthKey.split("-").map(Number)
    const month = monthNumber - 1
    const firstWeekday = (new Date(Date.UTC(year, month, 1)).getUTCDay() + 6) % 7
    const count = new Date(Date.UTC(year, month + 1, 0)).getUTCDate()
    return [
        ...Array.from({ length: firstWeekday }, () => null),
        ...Array.from({ length: count }, (_, index) => ({
            day: index + 1,
            key: dateKey(year, month, index + 1),
        })),
    ]
}

function adjacentMonth(monthKey: string, offset: number) {
    const [year, month] = monthKey.split("-").map(Number)
    const date = new Date(Date.UTC(year, month - 1 + offset, 1))
    return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`
}

function currentLocalDate() {
    const now = new Date()
    return dateKey(now.getFullYear(), now.getMonth(), now.getDate())
}

function browserTimezone() {
    try {
        return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"
    } catch {
        return "UTC"
    }
}

function subscribeToClientReadiness() {
    return () => undefined
}

export function CalendarDateTimeBlock({
    block,
    token,
    sessionBlockId,
    initialResponse,
    locked,
    preview,
    satisfied,
    onSatisfied,
    onUnsatisfied,
}: {
    block: CalendarBlock
    token: string
    sessionBlockId?: string
    initialResponse?: unknown
    locked: boolean
    preview: boolean
    satisfied: boolean
    onSatisfied: () => void
    onUnsatisfied: () => void
}) {
    const stored = normalizeCalendarResponse(initialResponse)
    const clientReady = useSyncExternalStore(subscribeToClientReadiness, () => true, () => false)
    const fallbackMonth = new Date().toISOString().slice(0, 7)
    const today = clientReady ? currentLocalDate() : ""
    const [selectedMonth, setSelectedMonth] = useState(stored?.date.slice(0, 7) ?? "")
    const visibleMonth = selectedMonth || (today ? today.slice(0, 7) : fallbackMonth)
    const [selectedDate, setSelectedDate] = useState(stored?.date ?? "")
    const [selectedTime, setSelectedTime] = useState(stored?.time ?? "")
    const timezone = stored?.timezone ?? (clientReady ? browserTimezone() : "UTC")
    const [savedResponse, setSavedResponse] = useState(initialResponse)
    const [error, setError] = useState<string | null>(null)
    const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved" | "error">(satisfied ? "saved" : "idle")
    const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
    const saveQueueRef = useRef<{ version: number; date: string; time: string } | null>(null)
    const savePumpRef = useRef<Promise<void> | null>(null)
    const saveVersionRef = useRef(0)
    const mountedRef = useRef(true)
    const onSatisfiedRef = useRef(onSatisfied)
    const onUnsatisfiedRef = useRef(onUnsatisfied)
    const days = useMemo(() => monthDays(visibleMonth), [visibleMonth])
    const monthLabel = useMemo(() => {
        const [year, month] = visibleMonth.split("-").map(Number)
        return new Intl.DateTimeFormat("en", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(year, month - 1, 1)))
    }, [visibleMonth])

    useEffect(() => {
        onSatisfiedRef.current = onSatisfied
        onUnsatisfiedRef.current = onUnsatisfied
    }, [onSatisfied, onUnsatisfied])

    const flushSaveQueue = useCallback(() => {
        if (locked || preview || !sessionBlockId) return Promise.resolve()
        if (savePumpRef.current) return savePumpRef.current

        const pump = (async () => {
            while (saveQueueRef.current) {
                if (!navigator.onLine) {
                    if (mountedRef.current) {
                        setSaveStatus("error")
                        setError("Your date and time will save when you reconnect.")
                        onUnsatisfiedRef.current()
                    }
                    return
                }

                const pending = saveQueueRef.current
                saveQueueRef.current = null
                if (mountedRef.current) setSaveStatus("saving")
                const outcome = await saveCalendarBlockResponse(token, sessionBlockId, {
                    date: pending.date,
                    time: pending.time,
                    timezone,
                }).catch(() => ({ ok: false as const, error: "Could not save the date and time. Please try again." }))

                if (!outcome.ok) {
                    const newer = saveQueueRef.current as { version: number; date: string; time: string } | null
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
                    setSavedResponse(outcome.response)
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
    }, [locked, preview, sessionBlockId, timezone, token])

    const flushPendingSave = useCallback(async () => {
        if (saveTimerRef.current) {
            clearTimeout(saveTimerRef.current)
            saveTimerRef.current = null
        }
        await flushSaveQueue()
        if (saveQueueRef.current && navigator.onLine) await flushSaveQueue()
        if (saveQueueRef.current) {
            throw new Error("Your date and time have not saved yet. Check your connection and try again.")
        }
    }, [flushSaveQueue])

    useOnboardingSaveTask(`calendar:${sessionBlockId ?? block.id}`, flushPendingSave)

    const queueSave = useCallback((date: string, time: string) => {
        setError(null)
        if (!date || !time) {
            onUnsatisfiedRef.current()
            if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
            saveQueueRef.current = null
            setSaveStatus("idle")
            return
        }

        onSatisfiedRef.current()
        if (preview || !sessionBlockId) {
            setSavedResponse({ date, time, timezone, startsAt: new Date(`${date}T${time}:00`).toISOString() })
            setSaveStatus("saved")
            return
        }

        const version = saveVersionRef.current + 1
        saveVersionRef.current = version
        saveQueueRef.current = { version, date, time }
        setSaveStatus("saving")
        if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
        saveTimerRef.current = setTimeout(() => {
            saveTimerRef.current = null
            void flushSaveQueue()
        }, 400)
    }, [flushSaveQueue, preview, sessionBlockId, timezone])

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

    const savedLabel = preview ? formatCalendarSelection(savedResponse) : formatCalendarResponse(savedResponse)

    return (
        <div className="overflow-hidden rounded-2xl border border-black/10 bg-[var(--onboarding-page,#F8F7F3)]">
            <div className="border-b border-black/10 px-5 py-4">
                <p className="font-semibold text-[var(--onboarding-text,#0F172A)]">{block.title}</p>
                {block.description ? <p className="mt-1.5 text-sm leading-6 text-[var(--onboarding-muted,#475569)]">{block.description}</p> : null}
            </div>

            <div className="grid gap-5 p-4 sm:p-5 md:grid-cols-[minmax(0,1fr)_15rem]">
                <div className="min-w-0 rounded-xl border border-black/10 bg-[var(--onboarding-surface,#FFFFFF)] p-3 sm:p-4">
                    <div className="flex items-center justify-between gap-3">
                        <button type="button" disabled={locked} aria-label="Previous month" onClick={() => setSelectedMonth(adjacentMonth(visibleMonth, -1))} className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-xl text-[var(--onboarding-muted,#475569)] transition hover:bg-black/5 disabled:opacity-40">‹</button>
                        <p className="font-semibold text-[var(--onboarding-text,#0F172A)]">{monthLabel}</p>
                        <button type="button" disabled={locked} aria-label="Next month" onClick={() => setSelectedMonth(adjacentMonth(visibleMonth, 1))} className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-xl text-[var(--onboarding-muted,#475569)] transition hover:bg-black/5 disabled:opacity-40">›</button>
                    </div>
                    <div className="mt-3 grid grid-cols-7 text-center text-[11px] font-medium text-[var(--onboarding-muted,#475569)]">
                        {WEEKDAYS.map((weekday) => <span key={weekday} className="py-1">{weekday}</span>)}
                    </div>
                    <div className="mt-1 grid grid-cols-7 gap-1">
                        {days.map((day, index) => day ? (
                            <button
                                key={day.key}
                                type="button"
                                disabled={locked || Boolean(today && day.key < today)}
                                aria-pressed={selectedDate === day.key}
                                onClick={() => {
                                    setSelectedDate(day.key)
                                    queueSave(day.key, selectedTime)
                                }}
                                className={`aspect-square min-h-9 rounded-lg text-sm font-medium transition ${selectedDate === day.key ? "bg-[var(--onboarding-primary,#1E3A5F)] text-white" : day.key === today ? "border border-[var(--onboarding-primary,#1E3A5F)] text-[var(--onboarding-primary,#1E3A5F)]" : "text-[var(--onboarding-text,#0F172A)] hover:bg-black/5"} disabled:cursor-not-allowed disabled:opacity-30`}
                            >
                                {day.day}
                            </button>
                        ) : <span key={`empty-${index}`} aria-hidden="true" />)}
                    </div>
                </div>

                <div className="flex min-w-0 flex-col">
                    <label className="text-sm font-semibold text-[var(--onboarding-text,#0F172A)]">
                        {block.timeLabel}
                        <input
                            type="time"
                            step={900}
                            value={selectedTime}
                            disabled={locked}
                            onChange={(event) => {
                                setSelectedTime(event.target.value)
                                queueSave(selectedDate, event.target.value)
                            }}
                            className="mt-2 h-12 w-full rounded-xl border border-black/20 bg-[var(--onboarding-surface,#FFFFFF)] px-3 text-base text-[var(--onboarding-text,#0F172A)] outline-none transition focus:border-[var(--onboarding-primary,#1E3A5F)] focus:ring-4 focus:ring-black/5"
                        />
                    </label>
                    <p className="mt-2 text-xs leading-5 text-[var(--onboarding-muted,#475569)]">Saved in {timezone}.</p>

                    {savedLabel && saveStatus === "saved" ? <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-3 text-sm leading-5 text-emerald-900"><span className="font-semibold">Saved:</span> {savedLabel}</div> : null}
                    {error ? <p role="alert" className="mt-3 text-left text-sm text-red-700">{error} <RequestHelpLink />.</p> : null}
                    {!locked ? <p aria-live="polite" className="mt-4 text-xs text-[var(--onboarding-muted,#475569)]">{saveStatus === "saving" ? "Saving date and time…" : saveStatus === "saved" ? "Date and time saved" : saveStatus === "error" ? "Date and time not saved yet" : selectedDate || selectedTime ? "Choose both a date and time" : ""}</p> : null}
                </div>
            </div>
        </div>
    )
}
