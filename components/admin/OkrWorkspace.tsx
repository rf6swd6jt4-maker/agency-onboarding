"use client"

import Link from "next/link"
import { createPortal } from "react-dom"
import { useEffect, useMemo, useRef, useState, useTransition, type FormEvent, type KeyboardEvent, type ReactNode } from "react"
import { useRouter } from "next/navigation"
import { ListActionMenu } from "@/components/list/ListActionMenu"
import { RoundPill, SquarePill, Status } from "@/components/ui"
import { formatOkrMetricValue, okrGap } from "@/lib/admin/okr-metrics"
import { addUtcDays, buildOkrReportingDays, okrReportingCadenceLabel, okrReportingPeriod, okrReportingPeriodIndex, type OkrReportingDay } from "@/lib/admin/okr-reporting"
import type { OkrKeyResult, OkrMeasurement, WorkspaceOkr } from "@/lib/admin/okrs"
import { formatOkrDeadline, okrDisplayStatus, type WorkspaceOkrDisplayStatus } from "@/lib/admin/okr-title"
import { formatRelativeTime, shortId } from "@/lib/ui/relative-time"
import { workItemPriorityLabel } from "@/lib/work-item-priority"
import {
    addOkrKeyResult,
    addOkrMeasurement,
    commitOkr,
    createOkrAction,
    createOkrFromModal,
    deleteOkr,
    deleteOkrKeyResult,
    linkOkrAction,
    setOkrKeyResultCadence,
    setOkrStatus,
    unlinkOkrAction,
    updateActiveOkrDetails,
    updateActiveOkrKeyResultDescription,
    updateDraftOkrKeyResultMetric,
    updateOkr,
    updateOkrKeyResult,
} from "@/app/[workspaceSlug]/admin/actions"

type Person = { user_id: string; role: string; name: string }
type WorkItemOption = { id: string; title: string; status: string; priority: number; due_date: string | null }
type DialogState =
    | { type: "objective"; okrId: string }
    | { type: "result"; okrId: string; resultId: string }
    | { type: "add-objective" }
    | { type: "add-result"; okrId: string }
    | { type: "add-work"; okrId: string; resultId: string }
    | { type: "measurement"; okrId: string; resultId: string }

type Props = {
    workspaceSlug: string
    currentUserId: string
    okrs: WorkspaceOkr[]
    ownerOptions: Person[]
    workItems: WorkItemOption[]
    people: Record<string, string>
    today: string
}

type RunAction = (formData: FormData) => Promise<void>
type AfterAction = DialogState | "close" | undefined

const tableGrid = "grid grid-cols-[minmax(0,1fr)_repeat(2,5.25rem)] sm:grid-cols-[minmax(13rem,1fr)_repeat(3,minmax(5.5rem,0.38fr))]"
const editorClass = "w-full rounded-md border border-neutral-800 bg-black px-3 text-sm text-neutral-100 outline-none transition focus:border-neutral-500"
const modalInputClass = `mt-1.5 h-10 ${editorClass}`
const modalTextareaClass = "mt-1.5 w-full rounded-md border border-neutral-800 bg-black px-3 py-2 text-sm leading-6 text-neutral-100 outline-none transition focus:border-neutral-500"

function lifecycleTone(status: WorkspaceOkrDisplayStatus): "grey" | "yellow" | "green" | "red" {
    if (status === "Committed" || status === "Completed") return "green"
    if (status === "In review") return "yellow"
    if (status === "Cancelled") return "red"
    return "grey"
}

function workStatusTone(status: string): "neutral" | "yellow" | "emerald" | "red" {
    if (status === "done") return "emerald"
    if (status === "doing" || status === "waiting") return "yellow"
    if (status === "blocked" || status === "canceled") return "red"
    return "neutral"
}

function priorityTone(priority: number): "red" | "yellow" | "neutral" {
    if (priority === 1) return "red"
    if (priority === 2) return "yellow"
    return "neutral"
}

function displayDate(date: string | null) {
    return date ? formatOkrDeadline(date) : "No deadline"
}

function ProgressRing({ progress, compact = false }: { progress: number; compact?: boolean }) {
    const bounded = Math.max(0, Math.min(100, progress))
    const circumference = 2 * Math.PI * 25
    return <div className={`relative shrink-0 ${compact ? "h-9 w-9" : "h-12 w-12"}`} aria-label={`${Math.round(bounded)} percent attained`}>
        <svg viewBox="0 0 64 64" className="h-full w-full -rotate-90" aria-hidden="true">
            <circle cx="32" cy="32" r="25" fill="none" stroke="rgb(38 38 38)" strokeWidth={compact ? 5 : 4.5} />
            <circle cx="32" cy="32" r="25" fill="none" stroke="white" strokeWidth={compact ? 5 : 4.5} strokeLinecap="round" strokeDasharray={circumference} strokeDashoffset={circumference * (1 - bounded / 100)} />
        </svg>
        <span className={`absolute inset-0 flex items-center justify-center font-semibold tabular-nums text-white ${compact ? "text-[9px]" : "text-[11px]"}`}>{Math.round(bounded)}%</span>
    </div>
}

function MetricEditor({ label, context, value, displayValue, pending, onSubmit, hiddenInputs, className = "" }: { label: string; context: string; value: number; displayValue: string; pending: boolean; onSubmit: (event: FormEvent<HTMLFormElement>) => void; hiddenInputs?: ReactNode; className?: string }) {
    const [open, setOpen] = useState(false)
    const [draft, setDraft] = useState(String(value))
    const rootRef = useRef<HTMLDivElement>(null)
    const formRef = useRef<HTMLFormElement>(null)

    useEffect(() => {
        if (!open) return
        const closeOutside = (event: PointerEvent) => {
            if (rootRef.current?.contains(event.target as Node)) return
            const consumeClick = (clickEvent: globalThis.MouseEvent) => {
                clickEvent.preventDefault()
                clickEvent.stopPropagation()
                window.clearTimeout(clearConsumeClick)
            }
            document.addEventListener("click", consumeClick, { capture: true, once: true })
            const clearConsumeClick = window.setTimeout(() => document.removeEventListener("click", consumeClick, true), 500)
            if (draft === String(value)) setOpen(false)
            else if (formRef.current?.checkValidity()) formRef.current.requestSubmit()
        }
        const closeOnEscape = (event: globalThis.KeyboardEvent) => {
            if (event.key !== "Escape") return
            setDraft(String(value))
            setOpen(false)
        }
        document.addEventListener("pointerdown", closeOutside)
        document.addEventListener("keydown", closeOnEscape)
        return () => { document.removeEventListener("pointerdown", closeOutside); document.removeEventListener("keydown", closeOnEscape) }
    }, [draft, open, value])

    const inputWidth = `${Math.max(7, Math.min(18, draft.length + 2))}ch`
    return <div ref={rootRef} className={`relative inline-flex justify-end ${className}`} onClick={(event) => event.stopPropagation()}>
        <button type="button" aria-label={`Edit ${label} for ${context}`} aria-expanded={open} onClick={() => { setDraft(String(value)); setOpen((current) => !current) }} className="rounded px-1 py-1 tabular-nums underline decoration-dotted decoration-neutral-700 underline-offset-4 transition hover:bg-neutral-900 hover:text-white focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/70">{displayValue}</button>
        {open ? <form ref={formRef} onSubmit={(event) => { if (draft === String(value)) event.preventDefault(); else onSubmit(event); setOpen(false) }} onKeyDown={(event) => event.stopPropagation()} className="absolute bottom-full right-0 z-40 mb-1.5 rounded-lg border border-neutral-700 bg-neutral-950 p-2 shadow-xl shadow-black/70">
            {hiddenInputs}
            <label className="block text-left text-[10px] font-medium uppercase tracking-wide text-neutral-500">{label}</label>
            <input name="value" aria-label={`${label} value for ${context}`} type="number" step="any" required autoFocus disabled={pending} value={draft} onChange={(event) => setDraft(event.target.value)} style={{ width: inputWidth }} className="mt-1 h-8 max-w-[calc(100vw-4rem)] rounded-md border border-neutral-700 bg-black px-2 text-right text-sm tabular-nums text-white outline-none transition focus:border-neutral-400 disabled:opacity-60" />
        </form> : null}
    </div>
}

function Modal({ title, description, error, size = "default", onClose, children }: { title: string; description?: string; error?: string | null; size?: "compact" | "default" | "medium" | "wide"; onClose: () => void; children: ReactNode }) {
    const parentDocument = typeof window !== "undefined" && window.parent !== window ? window.parent.document : typeof document !== "undefined" ? document : null
    if (!parentDocument) return null
    const widthClass = size === "wide" ? "max-w-5xl" : size === "medium" ? "max-w-3xl" : size === "compact" ? "max-w-sm" : "max-w-2xl"
    return createPortal(<div role="dialog" aria-modal="true" aria-label={title} data-work-item-popup className="fixed inset-0 z-[100] flex items-center justify-center overflow-hidden overscroll-none bg-black/75 p-3 backdrop-blur-sm sm:p-4" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
        <div className={`max-h-[calc(100vh-1.5rem)] min-w-0 w-full ${widthClass} touch-pan-y overflow-x-hidden overflow-y-auto overscroll-contain rounded-2xl border border-neutral-700 bg-neutral-950 shadow-2xl shadow-black/70 sm:max-h-[calc(100vh-2rem)]`}>
            <div className="sticky top-0 z-20 flex items-start gap-4 border-b border-neutral-800 bg-neutral-950/95 px-4 py-3 backdrop-blur sm:px-5 sm:py-4">
                <div className="min-w-0 flex-1"><h2 className="truncate text-lg font-semibold text-white">{title}</h2>{description ? <p className="mt-1 text-sm leading-5 text-neutral-500">{description}</p> : null}</div>
                <button type="button" onClick={onClose} aria-label="Close" className="rounded-md px-2 py-1 text-xl text-neutral-500 hover:bg-neutral-900 hover:text-white">×</button>
            </div>
            {error ? <div role="alert" className="mx-4 mt-4 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-200 sm:mx-5">{error}</div> : null}
            {children}
        </div>
    </div>, parentDocument.body)
}

function NewKeyResultFields() {
    const [unit, setUnit] = useState("number")
    return <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-sm text-neutral-300 sm:col-span-2">Key Result<input name="name" required autoFocus placeholder="Increase booked calls" className={modalInputClass} /></label>
        <label className="text-sm text-neutral-300 sm:col-span-2">Description <span className="text-neutral-600">(optional)</span><textarea name="description" rows={2} className={modalTextareaClass} /></label>
        <label className="text-sm text-neutral-300">Base<input name="baseline_value" type="number" step="any" required placeholder="100" className={modalInputClass} /></label>
        <label className="text-sm text-neutral-300">Target<input name="target_value" type="number" step="any" required placeholder="300" className={modalInputClass} /></label>
        <label className="text-sm text-neutral-300">Unit<select name="unit" value={unit} onChange={(event) => setUnit(event.target.value)} className={modalInputClass}><option value="number">Number</option><option value="percentage">Percentage</option><option value="currency">Currency</option><option value="duration">Duration (hours)</option></select></label>
        <label className="text-sm text-neutral-300">Direction<select name="comparator" defaultValue="at_least" className={modalInputClass}><option value="at_least">Higher is better</option><option value="at_most">Lower is better</option></select></label>
        <label className="text-sm text-neutral-300 sm:col-span-2">Reporting cadence<select name="reporting_cadence" required defaultValue="" className={modalInputClass}><option value="" disabled>Choose cadence…</option><option value="daily">Daily</option><option value="weekly">Weekly</option><option value="manual">Manual</option></select></label>
        {unit === "currency" ? <label className="text-sm text-neutral-300 sm:col-span-2">Currency code<input name="currency_code" defaultValue="USD" maxLength={3} className={`${modalInputClass} uppercase`} /></label> : null}
    </div>
}

function TrendChart({ result, days }: { result: OkrKeyResult; days: OkrReportingDay<OkrMeasurement>[] }) {
    const [activeIndex, setActiveIndex] = useState<number | null>(null)
    const plotted = days.flatMap((day, index) => day.measurement ? [{ index, date: day.date, value: day.measurement.value }] : [])
    const values = [result.baseline_value, result.target_value, ...plotted.map((point) => point.value)]
    const rawMin = Math.min(...values)
    const rawMax = Math.max(...values)
    const span = rawMax - rawMin || 1
    const min = rawMin - span * 0.08
    const max = rawMax + span * 0.08
    const chartWidth = 480
    const chartBottom = 136
    const x = (index: number) => 4 + index * ((chartWidth - 8) / Math.max(1, days.length - 1))
    const y = (value: number) => 122 - ((value - min) / (max - min)) * 108
    const runs = plotted.reduce<typeof plotted[]>((groups, point) => {
        const current = groups.at(-1)
        const previous = current?.at(-1)
        const crossedMiss = previous ? days.slice(previous.index + 1, point.index).some((day) => day.state === "missed") : false
        if (!current || crossedMiss) groups.push([point])
        else current.push(point)
        return groups
    }, [])
    const unchanged = plotted.filter((point, index) => {
        const previous = plotted[index - 1]
        return previous && previous.value === point.value && !days.slice(previous.index + 1, point.index).some((day) => day.state === "missed")
    })
    const activePoint = activeIndex === null ? null : plotted.find((point) => point.index === activeIndex) ?? null
    const dateLabel = (date: string) => new Intl.DateTimeFormat("en-IE", { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${date}T00:00:00Z`))
    const labelIndexes = [0, Math.floor((days.length - 1) / 2), days.length - 1]
    const gradientId = `trend-fill-${result.id}`
    return <div className="min-w-0">
        <svg viewBox={`0 0 ${chartWidth} 166`} className="h-44 w-full overflow-visible sm:h-52" role="img" aria-label={`${result.name} measurement trend`} onPointerLeave={() => setActiveIndex(null)}>
            <defs><linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="white" stopOpacity="0.2" /><stop offset="100%" stopColor="white" stopOpacity="0" /></linearGradient></defs>
            <line x1="4" x2={chartWidth - 4} y1={y(result.baseline_value)} y2={y(result.baseline_value)} stroke="rgb(38 38 38)" />
            <line x1="4" x2={chartWidth - 4} y1={y(result.target_value)} y2={y(result.target_value)} stroke="rgb(82 82 82)" strokeDasharray="5 5" />
            {days.map((day, index) => day.state === "missed" ? <line key={`miss-${day.date}`} x1={x(index)} x2={x(index)} y1={chartBottom - 5} y2={chartBottom} stroke="rgb(185 28 28)" strokeWidth="2" strokeLinecap="round" /> : null)}
            {runs.map((run, index) => run.length > 1 ? <g key={`run-${index}`}><polygon points={`${x(run[0].index)},${chartBottom} ${run.map((point) => `${x(point.index)},${y(point.value)}`).join(" ")} ${x(run.at(-1)!.index)},${chartBottom}`} fill={`url(#${gradientId})`} /><polyline points={run.map((point) => `${x(point.index)},${y(point.value)}`).join(" ")} fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></g> : null)}
            {unchanged.map((point) => <line key={`same-${point.date}`} x1={x(point.index) - 4} x2={x(point.index) + 4} y1={y(point.value)} y2={y(point.value)} stroke="rgb(163 163 163)" strokeWidth="4" strokeLinecap="round" />)}
            {plotted.map((point) => <rect key={`hit-${point.date}`} x={x(point.index) - 8} y="4" width="16" height={chartBottom - 4} fill="transparent" tabIndex={0} className="outline-none" aria-label={`${dateLabel(point.date)}: ${formatOkrMetricValue(point.value, result.unit, result.currency_code ?? "USD")}`} onPointerEnter={() => setActiveIndex(point.index)} onPointerDown={() => setActiveIndex(point.index)} onFocus={() => setActiveIndex(point.index)} onBlur={() => setActiveIndex(null)} />)}
            {activePoint ? <g pointerEvents="none"><circle cx={x(activePoint.index)} cy={y(activePoint.value)} r="4" fill="white" stroke="black" strokeWidth="2" /><rect x={Math.max(4, Math.min(chartWidth - 132, x(activePoint.index) - 64))} y={Math.max(4, y(activePoint.value) - 42)} width="128" height="34" rx="7" fill="rgb(23 23 23)" stroke="rgb(82 82 82)" /><text x={Math.max(12, Math.min(chartWidth - 124, x(activePoint.index) - 56))} y={Math.max(17, y(activePoint.value) - 27)} fill="rgb(163 163 163)" fontSize="9">{dateLabel(activePoint.date)}</text><text x={Math.max(12, Math.min(chartWidth - 124, x(activePoint.index) - 56))} y={Math.max(29, y(activePoint.value) - 15)} fill="white" fontSize="10" fontWeight="600">{formatOkrMetricValue(activePoint.value, result.unit, result.currency_code ?? "USD")}</text></g> : null}
            {!plotted.length ? <text x={chartWidth / 2} y="76" textAnchor="middle" fill="rgb(64 64 64)" fontSize="11">No reports in this period</text> : null}
            {labelIndexes.map((index, position) => <text key={days[index].date} x={x(index)} y="160" textAnchor={position === 0 ? "start" : position === 2 ? "end" : "middle"} fill="rgb(82 82 82)" fontSize="9">{dateLabel(days[index].date)}</text>)}
        </svg>
    </div>
}

function AccountabilityTracker({ result, people, today, startDate, onRecord }: { result: OkrKeyResult; people: Record<string, string>; today: string; startDate: string; onRecord?: () => void }) {
    const latestPeriodIndex = okrReportingPeriodIndex(startDate, today)
    const [periodIndex, setPeriodIndex] = useState(latestPeriodIndex)
    const periodDates = okrReportingPeriod(startDate, periodIndex)
    const periodStart = periodDates[0]
    const days = useMemo(() => buildOkrReportingDays({ cadence: result.reporting_cadence, reportingStartedOn: result.reporting_started_on, measurements: result.measurements, today, windowStart: periodStart }), [periodStart, result.measurements, result.reporting_cadence, result.reporting_started_on, today])
    const [selectedDate, setSelectedDate] = useState<string | null>(null)
    const selectedReports = selectedDate ? result.measurements.filter((measurement) => measurement.reported_on === selectedDate).sort((left, right) => right.measured_at.localeCompare(left.measured_at)) : []
    const weekdayLabels = days.slice(0, 7).map((day) => new Intl.DateTimeFormat("en-IE", { weekday: "narrow", timeZone: "UTC" }).format(new Date(`${day.date}T00:00:00Z`)))
    const stateClass: Record<OkrReportingDay["state"], string> = {
        reported: "border-white bg-white text-black",
        due: "border-amber-500/70 bg-amber-500/10 text-amber-200",
        missed: "border-red-700/70 bg-red-950/40 text-red-300",
        before: "border-neutral-900 text-neutral-800",
        future: "border-neutral-900 text-neutral-800",
        none: "border-neutral-800 text-neutral-700",
    }
    const changePeriod = (next: number) => { setSelectedDate(null); setPeriodIndex(next) }
    return <section className="border-t border-neutral-800 px-4 py-4 sm:px-5 sm:py-5">
        <div className="mb-4 flex items-center justify-between gap-3"><p className="text-sm font-medium text-neutral-300">Accountability</p>{onRecord ? <button type="button" onClick={onRecord} className="h-8 rounded-md border border-neutral-700 px-2.5 text-xs text-neutral-300 hover:border-neutral-500 hover:text-white">Record progress</button> : null}</div>
        <div className="grid gap-5 md:grid-cols-[minmax(280px,0.85fr)_minmax(0,1.4fr)] md:items-start xl:grid-cols-[360px_minmax(0,1fr)]">
            <div className="min-w-0"><div className="mb-2 flex h-7 items-center justify-between"><span className="text-[10px] text-neutral-600">{formatOkrDeadline(days[0].date)} – {formatOkrDeadline(days.at(-1)!.date)}</span>{latestPeriodIndex > 0 ? <div className="flex items-center gap-1"><button type="button" disabled={periodIndex === 0} onClick={() => changePeriod(periodIndex - 1)} aria-label="Previous reporting period" className="flex h-7 w-7 items-center justify-center rounded-md border border-neutral-800 text-sm text-neutral-500 hover:border-neutral-600 hover:text-white disabled:cursor-default disabled:opacity-25">‹</button><button type="button" disabled={periodIndex === latestPeriodIndex} onClick={() => changePeriod(periodIndex + 1)} aria-label="Next reporting period" className="flex h-7 w-7 items-center justify-center rounded-md border border-neutral-800 text-sm text-neutral-500 hover:border-neutral-600 hover:text-white disabled:cursor-default disabled:opacity-25">›</button></div> : null}</div><div className="grid grid-cols-7 gap-1">{weekdayLabels.map((label, index) => <span key={`${label}-${index}`} className="pb-0.5 text-center text-[10px] text-neutral-700">{label}</span>)}{days.map((day) => <button key={day.date} type="button" disabled={!day.measurement} onClick={() => setSelectedDate(day.date)} aria-label={`${day.date}: ${day.state}${day.reportCount > 1 ? `, ${day.reportCount} reports` : ""}`} className={`aspect-square min-h-7 rounded border text-[10px] tabular-nums transition ${stateClass[day.state]} ${day.measurement ? "cursor-pointer hover:ring-2 hover:ring-neutral-500" : "cursor-default"}`}>{Number(day.date.slice(-2))}</button>)}</div><div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-neutral-600"><span><i className="mr-1 inline-block h-2 w-2 rounded-sm bg-white" />Reported</span><span><i className="mr-1 inline-block h-2 w-2 rounded-sm border border-amber-500/70" />Due</span><span><i className="mr-1 inline-block h-2 w-2 rounded-sm border border-red-700/70" />Missed</span></div></div>
            <TrendChart result={result} days={days} />
        </div>
        {selectedDate && selectedReports.length ? <Modal title={formatOkrDeadline(selectedDate)} description={`${result.name} · ${selectedReports.length} report${selectedReports.length === 1 ? "" : "s"}`} size="compact" onClose={() => setSelectedDate(null)}><div className="divide-y divide-neutral-800">{selectedReports.map((measurement) => <div key={measurement.id} className="p-4 sm:p-5"><div className="flex items-start justify-between gap-4"><div><p className="text-[10px] font-medium uppercase tracking-wide text-neutral-600">Value</p><p className="mt-1 text-xl font-semibold tabular-nums text-white">{formatOkrMetricValue(measurement.value, result.unit, result.currency_code ?? "USD")}</p></div><div className="text-right"><p className="text-[10px] font-medium uppercase tracking-wide text-neutral-600">Recorded by</p><p className="mt-1 text-sm text-neutral-300">{people[measurement.recorded_by ?? ""] ?? "Admin"}</p></div></div><div className="mt-4 rounded-lg border border-neutral-800 bg-black/40 px-3 py-2.5"><p className="text-[10px] font-medium uppercase tracking-wide text-neutral-600">Notes</p><p className="mt-1 text-sm leading-6 text-neutral-300">{measurement.note || "No notes recorded."}</p></div></div>)}</div></Modal> : null}
    </section>
}

function WorkItems({ workspaceSlug, okr, result, people, onAdd, onUnlink }: { workspaceSlug: string; okr: WorkspaceOkr; result: OkrKeyResult; people: Record<string, string>; onAdd: () => void; onUnlink: (workItemId: string) => void }) {
    return <section className="border-t border-neutral-800">
        <div className="flex items-center justify-between gap-3 px-4 py-3 sm:px-5"><p className="text-xs font-medium text-neutral-300">Work items <span className="ml-1 tabular-nums text-neutral-600">{result.actions.length}</span></p>{okr.status === "active" ? <button type="button" onClick={onAdd} className="h-8 rounded-md border border-neutral-700 px-2.5 text-xs text-neutral-300 hover:border-neutral-500 hover:text-white">Add work</button> : null}</div>
        {result.actions.length ? <div className="divide-y divide-neutral-900 border-t border-neutral-900">{result.actions.map((action) => {
            const assignees = action.assignee_ids.map((id) => people[id] ?? "Team member")
            const actions = [okr.status === "active" ? { label: "Unlink from Key Result", action: () => onUnlink(action.id), danger: true, confirmMessage: "Unlink this work item from the Key Result? The work item itself will remain." } : null]
            return <div key={action.id} className="px-4 py-2.5 sm:px-5">
                <div className="xl:hidden">
                    <div className="flex min-w-0 items-center gap-2"><Link href={`/${workspaceSlug}/work-items/${action.id}`} className="min-w-0 flex-1 truncate text-sm font-medium text-neutral-200 hover:text-white hover:underline hover:decoration-neutral-600 hover:underline-offset-4">{action.title}</Link><RoundPill tone={priorityTone(action.priority)}>{workItemPriorityLabel(action.priority)}</RoundPill><SquarePill tone={workStatusTone(action.status)} className="shrink-0 capitalize">{action.status.replace(/_/g, " ")}</SquarePill><ListActionMenu label={`Actions for ${action.title}`} actions={actions} /></div>
                    {action.description ? <p className="mt-1 truncate text-xs text-neutral-600">{action.description}</p> : null}
                    <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-neutral-600"><span className="font-mono text-neutral-700">{shortId(action.id)}</span><span>{assignees.length ? assignees.join(", ") : "Unassigned"}</span><span>Added {formatRelativeTime(action.created_at)}</span><span>Due {displayDate(action.due_date)}</span></div>
                </div>
                <div className="hidden min-h-10 grid-cols-[minmax(220px,1fr)_auto_auto_minmax(100px,auto)_auto_auto_32px] items-center gap-3 xl:grid">
                    <div className="min-w-0"><Link href={`/${workspaceSlug}/work-items/${action.id}`} className="block truncate text-sm font-medium text-neutral-200 hover:text-white hover:underline hover:decoration-neutral-600 hover:underline-offset-4">{action.title}</Link>{action.description ? <p className="mt-0.5 truncate text-xs text-neutral-600">{action.description}</p> : null}</div>
                    <RoundPill tone={priorityTone(action.priority)}>{workItemPriorityLabel(action.priority)}</RoundPill>
                    <SquarePill tone={workStatusTone(action.status)} className="capitalize">{action.status.replace(/_/g, " ")}</SquarePill>
                    <span className="truncate text-xs text-neutral-600">{assignees.length ? assignees.join(", ") : "Unassigned"}</span>
                    <span className="whitespace-nowrap text-xs text-neutral-600">Added {formatRelativeTime(action.created_at)}</span>
                    <span className="whitespace-nowrap text-xs text-neutral-600">Due {displayDate(action.due_date)}</span>
                    <ListActionMenu label={`Actions for ${action.title}`} actions={actions} />
                </div>
            </div>
        })}</div> : <p className="border-t border-neutral-900 px-4 py-5 text-sm text-neutral-600 sm:px-5">No work items linked.</p>}
    </section>
}

function ObjectiveDetails({ workspaceSlug, okr, ownerOptions, today, pending, run, runWithoutForm, onAddResult }: { workspaceSlug: string; okr: WorkspaceOkr; ownerOptions: Person[]; today: string; pending: boolean; run: (event: FormEvent<HTMLFormElement>, action: RunAction, after?: AfterAction) => void; runWithoutForm: (action: () => Promise<void>, after?: AfterAction) => void; onAddResult: () => void }) {
    const [dirty, setDirty] = useState(false)
    const [completing, setCompleting] = useState(false)
    const draft = okr.status === "draft"
    const active = okr.status === "active"
    const editable = draft || active
    const lifecycle = okrDisplayStatus({ status: okr.status, deadline: okr.period_end, today })
    const submitAction = draft ? updateOkr.bind(null, workspaceSlug, okr.id) : updateActiveOkrDetails.bind(null, workspaceSlug, okr.id)

    return <div>
        <form key={okr.updated_at} onSubmit={(event) => run(event, submitAction)} onChange={() => setDirty(true)} onReset={() => setDirty(false)} className="p-4 sm:p-5">
            <div className="mb-5 flex items-center gap-3 border-b border-neutral-800 pb-4"><ProgressRing progress={okr.attainment} /><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><Status label={lifecycle} tone={lifecycleTone(lifecycle)} />{okr.is_test ? <SquarePill tone="yellow">Test</SquarePill> : null}<span className="font-mono text-xs text-neutral-600">OKR-{shortId(okr.id)}</span></div><p className="mt-1 text-xs text-neutral-500">{okr.key_results.length} Key Result{okr.key_results.length === 1 ? "" : "s"} · updated {formatRelativeTime(okr.updated_at)}</p></div></div>
            <div className="grid gap-4 sm:grid-cols-2">
                <label className="text-sm text-neutral-400 sm:col-span-2">Objective{draft ? <input name="objective" required defaultValue={okr.objective} className={modalInputClass} /> : <span className="mt-1.5 block min-h-10 rounded-md border border-neutral-900 bg-black/40 px-3 py-2 text-sm text-neutral-100">{okr.objective}</span>}</label>
                <label className="text-sm text-neutral-400">Owner{editable ? <select name="owner_user_id" defaultValue={okr.owner_user_id} className={modalInputClass}>{ownerOptions.map((person) => <option key={person.user_id} value={person.user_id}>{person.name}</option>)}</select> : <span className="mt-1.5 block min-h-10 rounded-md border border-neutral-900 bg-black/40 px-3 py-2 text-sm text-neutral-300">{ownerOptions.find((person) => person.user_id === okr.owner_user_id)?.name ?? "Admin"}</span>}</label>
                <div className="grid grid-cols-2 gap-3">
                    <label className="text-sm text-neutral-400">{draft ? "Starts" : "Started"}{draft ? <input name="period_start" type="date" required defaultValue={okr.period_start} className={modalInputClass} /> : <span className="mt-1.5 block min-h-10 rounded-md border border-neutral-900 bg-black/40 px-3 py-2 text-sm text-neutral-300">{formatOkrDeadline(okr.period_start)}</span>}</label>
                    <label className="text-sm text-neutral-400">Deadline{draft ? <input name="period_end" type="date" required defaultValue={okr.period_end} className={modalInputClass} /> : <span className="mt-1.5 block min-h-10 rounded-md border border-neutral-900 bg-black/40 px-3 py-2 text-sm text-neutral-300">{formatOkrDeadline(okr.period_end)}</span>}</label>
                </div>
                <label className="text-sm text-neutral-400 sm:col-span-2">Description{editable ? <textarea name="description" rows={3} defaultValue={okr.description ?? ""} placeholder="Add Objective context…" className={modalTextareaClass} /> : <span className="mt-1.5 block rounded-md border border-neutral-900 bg-black/40 px-3 py-2 text-sm leading-6 text-neutral-400">{okr.description || "No description."}</span>}</label>
            </div>
            {editable && dirty ? <div className="mt-4 flex justify-end gap-2"><button type="reset" className="h-9 px-3 text-sm text-neutral-500 hover:text-white">Cancel</button><button disabled={pending} className="h-9 rounded-md bg-white px-3 text-sm font-medium text-black disabled:opacity-50">{pending ? "Saving…" : "Save"}</button></div> : null}
        </form>

        <section className="border-t border-neutral-800 px-4 py-4 sm:px-5">
            <div className="mb-3 flex items-center justify-between gap-3"><h3 className="text-sm font-medium text-neutral-200">Key Results</h3>{draft ? <button type="button" onClick={onAddResult} className="inline-flex h-8 items-center gap-1.5 rounded-md border border-neutral-700 px-2.5 text-xs text-neutral-300 hover:border-neutral-500 hover:text-white"><span className="text-base leading-none">+</span> Add Key Result</button> : null}</div>
            {okr.key_results.length ? <div className="overflow-hidden rounded-lg border border-neutral-800">
                <div className={`grid ${draft ? "grid-cols-[minmax(0,1fr)_repeat(2,5rem)] sm:grid-cols-[minmax(13rem,1fr)_repeat(2,7rem)]" : "grid-cols-[minmax(0,1fr)_repeat(2,5rem)] sm:grid-cols-[minmax(13rem,1fr)_repeat(3,7rem)]"} border-b border-neutral-800 bg-neutral-900/60 text-[10px] font-medium uppercase tracking-wide text-neutral-600`}><span className="px-2 py-2 sm:px-3">Key Result</span><span className={`${draft ? "" : "hidden sm:block"} px-2 py-2 text-right sm:px-3`}>Base</span>{!draft ? <span className="px-2 py-2 text-right sm:px-3">Current</span> : null}<span className="px-2 py-2 text-right sm:px-3">Target</span></div>
                {okr.key_results.map((result) => {
                    const currency = result.currency_code ?? "USD"
                    return <div key={result.id} className={`grid ${draft ? "grid-cols-[minmax(0,1fr)_repeat(2,5rem)] sm:grid-cols-[minmax(13rem,1fr)_repeat(2,7rem)]" : "grid-cols-[minmax(0,1fr)_repeat(2,5rem)] sm:grid-cols-[minmax(13rem,1fr)_repeat(3,7rem)]"} border-b border-neutral-900 text-sm last:border-0`}><span className="break-words px-2 py-2.5 text-neutral-200 sm:truncate sm:px-3">{result.name}</span><span className={`${draft ? "" : "hidden sm:block"} px-2 py-2.5 text-right text-xs tabular-nums text-neutral-400 sm:px-3 sm:text-sm`}>{formatOkrMetricValue(result.baseline_value, result.unit, currency)}</span>{!draft ? <span className="px-2 py-2.5 text-right text-xs tabular-nums text-neutral-200 sm:px-3 sm:text-sm">{formatOkrMetricValue(result.current_value, result.unit, currency)}</span> : null}<span className="px-2 py-2.5 text-right text-xs tabular-nums text-neutral-400 sm:px-3 sm:text-sm">{formatOkrMetricValue(result.target_value, result.unit, currency)}</span></div>
                })}
            </div> : <p className="rounded-lg border border-dashed border-neutral-800 px-4 py-6 text-center text-sm text-neutral-600">No Key Results yet.</p>}
        </section>

        {okr.outcome_note ? <section className="border-t border-neutral-800 px-4 py-4 sm:px-5"><p className="text-xs font-medium uppercase tracking-wide text-neutral-600">Outcome</p><p className="mt-2 text-sm leading-6 text-neutral-400">{okr.outcome_note}</p></section> : null}

        {draft ? <div className="flex items-center justify-between border-t border-neutral-800 px-4 py-3 sm:px-5"><button type="button" disabled={pending} onClick={() => runWithoutForm(() => deleteOkr(workspaceSlug, okr.id), "close")} className="text-xs text-red-300/70 hover:text-red-200">Delete draft</button><button type="button" disabled={pending || !okr.key_results.length} onClick={() => runWithoutForm(() => commitOkr(workspaceSlug, okr.id))} className="h-9 rounded-md bg-white px-3 text-sm font-medium text-black disabled:cursor-not-allowed disabled:opacity-40">Commit Objective</button></div> : active ? <div className="border-t border-neutral-800 px-4 py-3 sm:px-5">{completing ? <form onSubmit={(event) => run(event, (formData) => setOkrStatus(workspaceSlug, okr.id, "completed", formData))} className="flex flex-col gap-2 sm:flex-row"><textarea name="outcome_note" required rows={2} autoFocus placeholder="Record the outcome and final assessment…" className={`${modalTextareaClass} mt-0 flex-1`} /><div className="flex items-end gap-2"><button type="button" onClick={() => setCompleting(false)} className="h-9 px-2 text-xs text-neutral-500 hover:text-white">Cancel</button><button disabled={pending} className="h-9 rounded-md bg-white px-3 text-xs font-medium text-black disabled:opacity-50">Confirm completion</button></div></form> : <div className="flex justify-end"><button type="button" onClick={() => setCompleting(true)} className="h-9 rounded-md border border-neutral-700 px-3 text-sm text-neutral-300 hover:border-neutral-500 hover:text-white">Complete Objective</button></div>}</div> : null}
    </div>
}

function DraftKeyResultForm({ workspaceSlug, okr, result, pending, run, runWithoutForm }: { workspaceSlug: string; okr: WorkspaceOkr; result: OkrKeyResult; pending: boolean; run: (event: FormEvent<HTMLFormElement>, action: RunAction, after?: AfterAction) => void; runWithoutForm: (action: () => Promise<void>, after?: AfterAction) => void }) {
    const [dirty, setDirty] = useState(false)
    const [unit, setUnit] = useState(result.unit)
    return <form key={`${result.id}-${result.name}-${result.baseline_value}-${result.target_value}-${result.reporting_cadence}`} onSubmit={(event) => run(event, updateOkrKeyResult.bind(null, workspaceSlug, okr.id, result.id))} onChange={() => setDirty(true)} onReset={() => { setDirty(false); setUnit(result.unit) }} className="p-4 sm:p-5">
        <div className="grid gap-4 sm:grid-cols-2">
            <label className="text-sm text-neutral-400 sm:col-span-2">Key Result<input name="name" required defaultValue={result.name} className={modalInputClass} /></label>
            <label className="text-sm text-neutral-400">Base<input name="baseline_value" type="number" step="any" required defaultValue={result.baseline_value} className={modalInputClass} /></label>
            <label className="text-sm text-neutral-400">Target<input name="target_value" type="number" step="any" required defaultValue={result.target_value} className={modalInputClass} /></label>
            <label className="text-sm text-neutral-400">Unit<select name="unit" value={unit} onChange={(event) => setUnit(event.target.value as OkrKeyResult["unit"])} className={modalInputClass}><option value="number">Number</option><option value="percentage">Percentage</option><option value="currency">Currency</option><option value="duration">Duration</option></select></label>
            <label className="text-sm text-neutral-400">Direction<select name="comparator" defaultValue={result.comparator} className={modalInputClass}><option value="at_least">Higher is better</option><option value="at_most">Lower is better</option></select></label>
            <label className="text-sm text-neutral-400">Reporting cadence<select name="reporting_cadence" required defaultValue={result.reporting_cadence ?? ""} className={modalInputClass}><option value="" disabled>Choose cadence…</option><option value="daily">Daily</option><option value="weekly">Weekly</option><option value="manual">Manual</option></select></label>
            {unit === "currency" ? <label className="text-sm text-neutral-400">Currency code<input name="currency_code" defaultValue={result.currency_code ?? "USD"} maxLength={3} className={`${modalInputClass} uppercase`} /></label> : null}
            <label className="text-sm text-neutral-400 sm:col-span-2">Description<textarea name="description" rows={3} defaultValue={result.description ?? ""} placeholder="Add Key Result context…" className={modalTextareaClass} /></label>
        </div>
        <div className="mt-5 flex items-center justify-between border-t border-neutral-800 pt-4"><button type="button" disabled={pending} onClick={() => runWithoutForm(() => deleteOkrKeyResult(workspaceSlug, okr.id, result.id), { type: "objective", okrId: okr.id })} className="text-xs text-red-300/70 hover:text-red-200">Delete Key Result</button>{dirty ? <div className="flex items-center gap-2"><button type="reset" className="h-9 px-2 text-sm text-neutral-500 hover:text-white">Cancel</button><button disabled={pending} className="h-9 rounded-md bg-white px-3 text-sm font-medium text-black disabled:opacity-50">{pending ? "Saving…" : "Save"}</button></div> : null}</div>
    </form>
}

function ActiveKeyResultDetails({ workspaceSlug, okr, result, people, today, pending, run, runWithoutForm, onRecord, onAddWork }: { workspaceSlug: string; okr: WorkspaceOkr; result: OkrKeyResult; people: Record<string, string>; today: string; pending: boolean; run: (event: FormEvent<HTMLFormElement>, action: RunAction, after?: AfterAction) => void; runWithoutForm: (action: () => Promise<void>, after?: AfterAction) => void; onRecord: () => void; onAddWork: () => void }) {
    const [dirty, setDirty] = useState(false)
    const currency = result.currency_code ?? "USD"
    const gap = okrGap(result.comparator, result.current_value, result.target_value)
    return <div>
        <div className="grid grid-cols-2 border-b border-neutral-800 sm:grid-cols-4">
            {[{ label: "Base", value: result.baseline_value }, { label: "Current", value: result.current_value }, { label: "Target", value: result.target_value }, { label: result.target_met ? "Result" : "Remaining", value: result.target_met ? null : gap }].map((metric, index) => <div key={metric.label} className={`px-4 py-3 sm:px-5 ${index % 2 ? "border-l border-neutral-800" : ""} ${index > 1 ? "border-t border-neutral-800 sm:border-t-0" : ""} ${index === 2 ? "sm:border-l" : ""}`}><p className="text-[10px] font-medium uppercase tracking-wide text-neutral-600">{metric.label}</p><p className="mt-1 text-sm font-medium tabular-nums text-neutral-200">{metric.value === null ? "Target reached" : formatOkrMetricValue(metric.value, result.unit, currency)}</p></div>)}
        </div>
        {okr.status === "active" ? <form key={`${result.id}-${result.description}`} onSubmit={(event) => run(event, updateActiveOkrKeyResultDescription.bind(null, workspaceSlug, okr.id, result.id))} onChange={() => setDirty(true)} onReset={() => setDirty(false)} className="px-4 py-4 sm:px-5"><label className="text-sm text-neutral-400">Description<textarea name="description" rows={3} defaultValue={result.description ?? ""} placeholder="Add Key Result context…" className={modalTextareaClass} /></label>{dirty ? <div className="mt-3 flex justify-end gap-2"><button type="reset" className="h-8 px-2 text-xs text-neutral-500 hover:text-white">Cancel</button><button disabled={pending} className="h-8 rounded-md bg-white px-3 text-xs font-medium text-black disabled:opacity-50">Save</button></div> : null}</form> : <div className="px-4 py-4 sm:px-5"><p className="text-xs font-medium uppercase tracking-wide text-neutral-600">Description</p><p className="mt-2 text-sm leading-6 text-neutral-400">{result.description || "No description."}</p></div>}
        {okr.status === "active" && !result.reporting_cadence ? <form onSubmit={(event) => run(event, setOkrKeyResultCadence.bind(null, workspaceSlug, okr.id, result.id))} className="flex flex-col gap-2 border-t border-amber-500/20 bg-amber-500/5 px-4 py-4 sm:flex-row sm:items-center sm:px-5"><div className="min-w-0 flex-1"><p className="text-sm font-medium text-neutral-200">Set reporting cadence</p><p className="mt-0.5 text-xs text-neutral-600">This one-time choice starts accountability today and locks permanently.</p></div><select name="reporting_cadence" required defaultValue="" className="h-9 rounded-md border border-neutral-700 bg-black px-2 text-xs text-neutral-200"><option value="" disabled>Choose cadence…</option><option value="daily">Daily</option><option value="weekly">Weekly</option><option value="manual">Manual</option></select><button disabled={pending} className="h-9 rounded-md bg-white px-3 text-xs font-medium text-black disabled:opacity-50">Set cadence</button></form> : result.reporting_cadence && result.reporting_started_on ? <AccountabilityTracker result={result} people={people} today={today} startDate={okr.period_start} onRecord={okr.status === "active" ? onRecord : undefined} /> : null}
        <WorkItems workspaceSlug={workspaceSlug} okr={okr} result={result} people={people} onAdd={onAddWork} onUnlink={(workItemId) => runWithoutForm(() => unlinkOkrAction(workspaceSlug, okr.id, result.id, workItemId))} />
    </div>
}

function KeyResultDetails(props: Parameters<typeof ActiveKeyResultDetails>[0] & { onDelete?: () => void }) {
    const { okr, result } = props
    if (okr.status === "draft") return <DraftKeyResultForm workspaceSlug={props.workspaceSlug} okr={okr} result={result} pending={props.pending} run={props.run} runWithoutForm={props.runWithoutForm} />
    return <ActiveKeyResultDetails {...props} />
}

function OkrMetricTable({ workspaceSlug, okrs, today, pending, run, onObjective, onResult, onAddObjective, onAddResult }: { workspaceSlug: string; okrs: WorkspaceOkr[]; today: string; pending: boolean; run: (event: FormEvent<HTMLFormElement>, action: RunAction, after?: AfterAction) => void; onObjective: (okrId: string) => void; onResult: (okrId: string, resultId: string) => void; onAddObjective: () => void; onAddResult: (okrId: string) => void }) {
    function activateRow(event: KeyboardEvent<HTMLDivElement>, action: () => void) {
        if (event.target !== event.currentTarget || (event.key !== "Enter" && event.key !== " ")) return
        event.preventDefault()
        action()
    }
    return <div className="overflow-hidden rounded-xl border border-neutral-800 bg-black">
        <div role="table" aria-label="Objectives and Key Result metrics" className="overflow-x-hidden sm:overflow-x-auto">
            <div className="w-full sm:min-w-[38rem]">
                <div role="row" className={`${tableGrid} h-10 border-b border-neutral-800 bg-neutral-950 text-[11px] font-medium uppercase tracking-wide text-neutral-500`}>
                    <div role="columnheader" className="sticky left-0 z-20 flex items-center bg-neutral-950 px-3 sm:px-4">Key Result</div>
                    <div role="columnheader" className="hidden items-center justify-end border-l border-neutral-900 px-4 sm:flex">Base</div>
                    <div role="columnheader" className="flex items-center justify-end border-l border-neutral-900 px-2 sm:px-4">Current</div>
                    <div role="columnheader" className="flex items-center justify-end border-l border-neutral-900 px-2 sm:px-4">Target</div>
                </div>
                {okrs.length ? okrs.flatMap((okr) => {
                    const lifecycle = okrDisplayStatus({ status: okr.status, deadline: okr.period_end, today })
                    return [<div id={`okr-${okr.id}`} key={`objective-${okr.id}`} role="row" tabIndex={0} aria-label={`Open Objective ${okr.objective}`} onClick={() => onObjective(okr.id)} onKeyDown={(event) => activateRow(event, () => onObjective(okr.id))} className={`${tableGrid} group min-h-14 cursor-pointer scroll-mt-28 border-b border-neutral-800 bg-neutral-900/65 outline-none transition hover:bg-neutral-800/80 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-white/60`}>
                        <div role="rowheader" className="sticky left-0 z-10 flex min-w-0 items-center gap-1.5 bg-neutral-900 px-3 py-2 transition group-hover:bg-neutral-800 sm:gap-2 sm:px-4">
                            <span className="min-w-0 flex-1"><span className="block break-words text-[13px] font-semibold leading-5 text-white sm:truncate sm:text-sm">{okr.objective}</span><span className="mt-0.5 inline-flex sm:hidden"><Status label={lifecycle} tone={lifecycleTone(lifecycle)} /></span></span>
                            <span className="hidden shrink-0 sm:inline-flex"><Status label={lifecycle} tone={lifecycleTone(lifecycle)} /></span>
                            {okr.status === "draft" ? <button type="button" aria-label={`Add Key Result to ${okr.objective}`} onClick={(event) => { event.stopPropagation(); onAddResult(okr.id) }} className="hidden h-7 w-7 shrink-0 items-center justify-center rounded-md border border-neutral-700 text-base text-neutral-300 hover:border-neutral-500 hover:bg-neutral-700 hover:text-white sm:flex">+</button> : null}
                        </div>
                        <div role="cell" className="col-span-2 flex items-center justify-end gap-2 border-l border-neutral-800 px-2 sm:col-span-3 sm:px-4">{okr.is_test ? <SquarePill tone="yellow">Test</SquarePill> : null}<ProgressRing progress={okr.attainment} compact /></div>
                    </div>, ...okr.key_results.map((result) => {
                        const currency = result.currency_code ?? "USD"
                        const baseline = formatOkrMetricValue(result.baseline_value, result.unit, currency)
                        const current = formatOkrMetricValue(result.current_value, result.unit, currency)
                        const target = formatOkrMetricValue(result.target_value, result.unit, currency)
                        const draft = okr.status === "draft"
                        return <div id={`key-result-${result.id}`} key={result.id} role="row" tabIndex={0} aria-label={`Open Key Result ${result.name}`} onClick={() => onResult(okr.id, result.id)} onKeyDown={(event) => activateRow(event, () => onResult(okr.id, result.id))} className={`${tableGrid} group min-h-12 cursor-pointer scroll-mt-28 border-b border-neutral-900 bg-black outline-none transition last:border-b-0 hover:bg-neutral-950 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-white/60`}>
                            <div role="rowheader" className="sticky left-0 z-10 flex min-w-0 items-center bg-black px-3 py-1.5 pl-4 transition group-hover:bg-neutral-950 sm:px-4 sm:pl-8"><span className="break-words text-[13px] font-medium leading-5 text-neutral-200 sm:truncate sm:text-sm">{result.name}</span></div>
                            <div role="cell" className="relative hidden items-center justify-end border-l border-neutral-900 px-4 text-sm tabular-nums text-neutral-500 sm:flex">{draft ? <MetricEditor label="Base" context={result.name} value={result.baseline_value} displayValue={baseline} pending={pending} onSubmit={(event) => run(event, updateDraftOkrKeyResultMetric.bind(null, workspaceSlug, okr.id, result.id, "baseline_value"))} /> : baseline}</div>
                            <div role="cell" className="relative flex items-center justify-end border-l border-neutral-900 px-2 text-xs font-medium tabular-nums text-neutral-200 sm:px-4 sm:text-sm">{draft ? <><MetricEditor label="Base" context={result.name} value={result.baseline_value} displayValue={baseline} pending={pending} onSubmit={(event) => run(event, updateDraftOkrKeyResultMetric.bind(null, workspaceSlug, okr.id, result.id, "baseline_value"))} className="sm:hidden" /><span className="hidden sm:inline">{current}</span></> : okr.status === "active" ? <MetricEditor label="Current" context={result.name} value={result.current_value} displayValue={current} pending={pending} hiddenInputs={<input type="hidden" name="reported_on" value={today} />} onSubmit={(event) => run(event, addOkrMeasurement.bind(null, workspaceSlug, okr.id, result.id))} /> : current}</div>
                            <div role="cell" className="relative flex items-center justify-end border-l border-neutral-900 px-2 text-xs tabular-nums text-neutral-400 sm:px-4 sm:text-sm">{draft ? <MetricEditor label="Target" context={result.name} value={result.target_value} displayValue={target} pending={pending} onSubmit={(event) => run(event, updateDraftOkrKeyResultMetric.bind(null, workspaceSlug, okr.id, result.id, "target_value"))} /> : target}</div>
                        </div>
                    }), ...(okr.status === "draft" ? [<div key={`add-result-${okr.id}`} role="row" className={`${tableGrid} h-10 border-b border-neutral-800 bg-black sm:hidden`}><div role="cell" className="col-span-3 flex items-center justify-end px-2"><button type="button" aria-label={`Add Key Result to ${okr.objective}`} onClick={() => onAddResult(okr.id)} className="inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-xs text-neutral-500 transition hover:bg-neutral-900 hover:text-white"><span className="text-base leading-none">+</span> Add Key Result</button></div></div>] : [])]
                }) : <div role="row" className={`${tableGrid} h-14 border-b border-neutral-900`}><div role="cell" className="col-span-3 flex items-center justify-center px-4 text-sm text-neutral-600 sm:col-span-4">No Objectives yet.</div></div>}
            </div>
        </div>
        <div className="flex h-12 items-center justify-end border-t border-neutral-800 px-3"><button type="button" onClick={onAddObjective} className="inline-flex h-8 items-center gap-1.5 rounded-md border border-neutral-700 px-2.5 text-xs text-neutral-300 hover:border-neutral-500 hover:bg-neutral-900 hover:text-white"><span className="text-base leading-none">+</span> Add Objective</button></div>
    </div>
}

export function OkrWorkspace({ workspaceSlug, currentUserId, okrs, ownerOptions, workItems, people, today }: Props) {
    const router = useRouter()
    const [dialog, setDialog] = useState<DialogState | null>(null)
    const [error, setError] = useState<string | null>(null)
    const [pending, startTransition] = useTransition()

    const selectedOkr = dialog && "okrId" in dialog ? okrs.find((okr) => okr.id === dialog.okrId) ?? null : null
    const selectedResult = dialog && "resultId" in dialog && selectedOkr ? selectedOkr.key_results.find((result) => result.id === dialog.resultId) ?? null : null

    function showDialog(next: DialogState | null) {
        setError(null)
        setDialog(next)
    }

    function run(event: FormEvent<HTMLFormElement>, action: RunAction, after?: AfterAction) {
        event.preventDefault()
        const formData = new FormData(event.currentTarget)
        setError(null)
        startTransition(async () => {
            try {
                await action(formData)
                if (after === "close") setDialog(null)
                else if (after) setDialog(after)
                router.refresh()
            } catch (cause) {
                setError(cause instanceof Error ? cause.message : "This change could not be saved")
            }
        })
    }

    function runWithoutForm(action: () => Promise<void>, after?: AfterAction) {
        setError(null)
        startTransition(async () => {
            try {
                await action()
                if (after === "close") setDialog(null)
                else if (after) setDialog(after)
                router.refresh()
            } catch (cause) {
                setError(cause instanceof Error ? cause.message : "This change could not be saved")
            }
        })
    }

    return <div className="mt-5">
        {!dialog && error ? <div role="alert" className="mb-3 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-200">{error}</div> : null}
        <OkrMetricTable workspaceSlug={workspaceSlug} okrs={okrs} today={today} pending={pending} run={run} onObjective={(okrId) => showDialog({ type: "objective", okrId })} onResult={(okrId, resultId) => showDialog({ type: "result", okrId, resultId })} onAddObjective={() => showDialog({ type: "add-objective" })} onAddResult={(okrId) => showDialog({ type: "add-result", okrId })} />

        {dialog?.type === "objective" && selectedOkr ? <Modal title={selectedOkr.objective} description="Objective details" error={error} size="medium" onClose={() => showDialog(null)}><ObjectiveDetails key={`${selectedOkr.id}-${selectedOkr.updated_at}`} workspaceSlug={workspaceSlug} okr={selectedOkr} ownerOptions={ownerOptions} today={today} pending={pending} run={run} runWithoutForm={runWithoutForm} onAddResult={() => showDialog({ type: "add-result", okrId: selectedOkr.id })} /></Modal> : null}

        {dialog?.type === "result" && selectedOkr && selectedResult ? <Modal title={selectedResult.name} description={`Key Result · ${okrReportingCadenceLabel(selectedResult.reporting_cadence)} reporting`} error={error} size="wide" onClose={() => showDialog(null)}><KeyResultDetails workspaceSlug={workspaceSlug} okr={selectedOkr} result={selectedResult} people={people} today={today} pending={pending} run={run} runWithoutForm={runWithoutForm} onRecord={() => showDialog({ type: "measurement", okrId: selectedOkr.id, resultId: selectedResult.id })} onAddWork={() => showDialog({ type: "add-work", okrId: selectedOkr.id, resultId: selectedResult.id })} /></Modal> : null}

        {dialog?.type === "add-objective" ? <Modal title="Add Objective" description="Create a fully editable draft." error={error} onClose={() => showDialog(null)}><form onSubmit={(event) => run(event, async (formData) => { const result = await createOkrFromModal(workspaceSlug, formData); if (!result.ok) throw new Error(result.error ?? "This Objective could not be created") }, "close")} className="grid gap-3 p-4 sm:grid-cols-2 sm:p-5"><label className="text-sm text-neutral-300 sm:col-span-2">Objective<input name="objective" required autoFocus placeholder="Increase reliable monthly sales" className={modalInputClass} /></label><label className="text-sm text-neutral-300 sm:col-span-2">Description <span className="text-neutral-600">(optional)</span><textarea name="description" rows={2} className={modalTextareaClass} /></label><label className="text-sm text-neutral-300">Starts<input name="period_start" type="date" defaultValue={today} required className={modalInputClass} /></label><label className="text-sm text-neutral-300">Deadline<input name="period_end" type="date" defaultValue={addUtcDays(today, 90)} required className={modalInputClass} /></label><label className="text-sm text-neutral-300">Owner<select name="owner_user_id" defaultValue={ownerOptions.some((owner) => owner.user_id === currentUserId) ? currentUserId : ownerOptions[0]?.user_id} className={modalInputClass}>{ownerOptions.map((owner) => <option key={owner.user_id} value={owner.user_id}>{owner.name} · {owner.role}</option>)}</select></label><label className="text-sm text-neutral-300">Mode<select name="is_test" defaultValue="false" className={modalInputClass}><option value="false">Standard</option><option value="true">Test</option></select></label><div className="mt-2 flex justify-end sm:col-span-2"><button disabled={pending} className="h-10 rounded-md bg-white px-4 text-sm font-medium text-black disabled:opacity-50">{pending ? "Creating…" : "Add Objective"}</button></div></form></Modal> : null}

        {dialog?.type === "add-result" && selectedOkr ? <Modal title="Add Key Result" description={`Add a measurable result to ${selectedOkr.objective}.`} error={error} onClose={() => showDialog({ type: "objective", okrId: selectedOkr.id })}><form onSubmit={(event) => run(event, addOkrKeyResult.bind(null, workspaceSlug, selectedOkr.id), { type: "objective", okrId: selectedOkr.id })} className="p-4 sm:p-5"><NewKeyResultFields /><div className="mt-5 flex justify-end"><button disabled={pending} className="h-10 rounded-md bg-white px-4 text-sm font-medium text-black disabled:opacity-50">{pending ? "Adding…" : "Add Key Result"}</button></div></form></Modal> : null}

        {dialog?.type === "measurement" && selectedOkr && selectedResult ? <Modal title="Record progress" description={`${selectedResult.name} · current ${formatOkrMetricValue(selectedResult.current_value, selectedResult.unit, selectedResult.currency_code ?? "USD")}`} error={error} onClose={() => showDialog({ type: "result", okrId: selectedOkr.id, resultId: selectedResult.id })}><form onSubmit={(event) => run(event, addOkrMeasurement.bind(null, workspaceSlug, selectedOkr.id, selectedResult.id), { type: "result", okrId: selectedOkr.id, resultId: selectedResult.id })} className="grid gap-3 p-4 sm:grid-cols-2 sm:p-5"><label className="text-sm text-neutral-300">Current value<input name="value" type="number" step="any" required autoFocus defaultValue={selectedResult.current_value} className={modalInputClass} /></label><label className="text-sm text-neutral-300">Report date<input name="reported_on" type="date" required defaultValue={today} className={modalInputClass} /></label><label className="text-sm text-neutral-300 sm:col-span-2">Note <span className="text-neutral-600">(optional)</span><textarea name="note" rows={2} className={modalTextareaClass} /></label><div className="flex justify-end sm:col-span-2"><button disabled={pending} className="h-10 rounded-md bg-white px-4 text-sm font-medium text-black disabled:opacity-50">{pending ? "Recording…" : "Record progress"}</button></div></form></Modal> : null}

        {dialog?.type === "add-work" && selectedOkr && selectedResult ? (() => {
            const linkedIds = new Set(selectedResult.actions.map((action) => action.id))
            const available = workItems.filter((item) => !linkedIds.has(item.id))
            const returnTo: DialogState = { type: "result", okrId: selectedOkr.id, resultId: selectedResult.id }
            return <Modal title="Add work" description={`Create or link work for ${selectedResult.name}.`} error={error} onClose={() => showDialog(returnTo)}><div className="grid gap-5 p-4 sm:p-5 md:grid-cols-2"><form onSubmit={(event) => run(event, createOkrAction.bind(null, workspaceSlug, selectedOkr.id, selectedResult.id), returnTo)}><h3 className="font-medium">Create work item</h3><label className="mt-3 block text-sm text-neutral-300">Title<input name="title" required autoFocus placeholder="What needs to happen?" className={modalInputClass} /></label><label className="mt-3 block text-sm text-neutral-300">Description <span className="text-neutral-600">(optional)</span><textarea name="description" rows={3} className={modalTextareaClass} /></label><button disabled={pending} className="mt-4 h-10 w-full rounded-md bg-white px-3 text-sm font-medium text-black disabled:opacity-50">Create and link</button></form><form onSubmit={(event) => run(event, linkOkrAction.bind(null, workspaceSlug, selectedOkr.id, selectedResult.id), returnTo)} className="border-t border-neutral-800 pt-5 md:border-l md:border-t-0 md:pl-5 md:pt-0"><h3 className="font-medium">Link existing work</h3>{available.length ? <><label className="mt-3 block text-sm text-neutral-300">Work item<select name="work_item_id" className={modalInputClass}>{available.map((item) => <option key={item.id} value={item.id}>{item.title} · {workItemPriorityLabel(item.priority)}</option>)}</select></label><button disabled={pending} className="mt-4 h-10 w-full rounded-md border border-neutral-700 px-3 text-sm text-neutral-200 disabled:opacity-50">Link work item</button></> : <p className="mt-3 text-sm leading-6 text-neutral-600">Every available work item is already linked to this Key Result.</p>}</form></div></Modal>
        })() : null}
    </div>
}
