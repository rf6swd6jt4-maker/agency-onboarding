"use client"

import Link from "next/link"
import { createPortal } from "react-dom"
import { useMemo, useState, useTransition, type FormEvent, type ReactNode } from "react"
import { useRouter } from "next/navigation"
import { ListActionMenu } from "@/components/list/ListActionMenu"
import { RoundPill, SquarePill, Status } from "@/components/ui"
import { formatOkrMetricValue, okrGap } from "@/lib/admin/okr-metrics"
import { buildOkrReportingDays, okrReportingCadenceLabel, type OkrReportingDay } from "@/lib/admin/okr-reporting"
import type { OkrKeyResult, OkrMeasurement, WorkspaceOkr } from "@/lib/admin/okrs"
import { formatOkrDeadline, okrDisplayTitle } from "@/lib/admin/okr-title"
import { formatRelativeTime, shortId } from "@/lib/ui/relative-time"
import { workItemPriorityLabel } from "@/lib/work-item-priority"
import {
    addOkrKeyResult,
    addOkrMeasurement,
    commitOkr,
    createOkrAction,
    deleteOkr,
    deleteOkrKeyResult,
    linkOkrAction,
    setOkrKeyResultCadence,
    setOkrStatus,
    unlinkOkrAction,
    updateActiveOkrDetails,
    updateActiveOkrKeyResultDescription,
    updateOkr,
    updateOkrKeyResult,
} from "@/app/[workspaceSlug]/admin/actions"

type Person = { user_id: string; role: string; name: string }
type WorkItemOption = { id: string; title: string; status: string; priority: number; due_date: string | null }
type DialogState =
    | { type: "add-result"; okr: WorkspaceOkr }
    | { type: "add-work"; okr: WorkspaceOkr; result: OkrKeyResult }
    | { type: "measurement"; okr: WorkspaceOkr; result: OkrKeyResult }

type Props = {
    workspaceSlug: string
    okrs: WorkspaceOkr[]
    ownerOptions: Person[]
    workItems: WorkItemOption[]
    people: Record<string, string>
    today: string
}

const editorClass = "w-full rounded-md border border-transparent bg-transparent px-2 py-1 text-sm text-neutral-200 outline-none transition hover:border-neutral-800 hover:bg-neutral-950 focus:border-neutral-600 focus:bg-neutral-950 disabled:cursor-default disabled:hover:border-transparent disabled:hover:bg-transparent"
const modalInputClass = "mt-1.5 h-10 w-full rounded-lg border border-neutral-700 bg-black px-3 text-sm text-white outline-none focus:border-neutral-500"
const modalTextareaClass = "mt-1.5 w-full rounded-lg border border-neutral-700 bg-black px-3 py-2 text-sm leading-6 text-white outline-none focus:border-neutral-500"

function statusTone(status: string): "grey" | "yellow" | "green" | "red" {
    if (status === "completed") return "green"
    if (status === "active") return "yellow"
    if (status === "cancelled") return "red"
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

function DescriptionText({ text, className = "" }: { text: string | null; className?: string }) {
    const [expanded, setExpanded] = useState(false)
    if (!text) return null
    const expandable = text.length > 90
    return <div className={`flex min-w-0 items-start gap-1.5 ${className}`}>
        <p className={`min-w-0 text-sm leading-5 text-neutral-500 ${expandable && !expanded ? "truncate" : ""}`}>{text}</p>
        {expandable ? <button type="button" onClick={() => setExpanded((value) => !value)} className="shrink-0 text-xs leading-5 text-neutral-600 hover:text-neutral-300">{expanded ? "Less" : "More"}</button> : null}
    </div>
}

function ProgressRing({ progress }: { progress: number }) {
    const bounded = Math.max(0, Math.min(100, progress))
    const circumference = 2 * Math.PI * 25
    return <div className="relative h-12 w-12 shrink-0" aria-label={`${Math.round(bounded)} percent attained`}>
        <svg viewBox="0 0 64 64" className="h-full w-full -rotate-90" aria-hidden="true"><circle cx="32" cy="32" r="25" fill="none" stroke="rgb(38 38 38)" strokeWidth="4.5" /><circle cx="32" cy="32" r="25" fill="none" stroke="white" strokeWidth="4.5" strokeLinecap="round" strokeDasharray={circumference} strokeDashoffset={circumference * (1 - bounded / 100)} /></svg>
        <span className="absolute inset-0 flex items-center justify-center text-[11px] font-semibold tabular-nums text-white">{Math.round(bounded)}%</span>
    </div>
}

function Modal({ title, description, onClose, children }: { title: string; description?: string; onClose: () => void; children: ReactNode }) {
    const parentDocument = typeof window !== "undefined" && window.parent !== window ? window.parent.document : typeof document !== "undefined" ? document : null
    if (!parentDocument) return null
    return createPortal(<div role="dialog" aria-modal="true" aria-label={title} data-work-item-popup className="fixed inset-0 z-[100] flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
        <div className="max-h-[calc(100vh-2rem)] w-full max-w-2xl overflow-y-auto rounded-2xl border border-neutral-700 bg-neutral-950 shadow-2xl shadow-black/70">
            <div className="flex items-start gap-4 border-b border-neutral-800 px-5 py-4"><div className="min-w-0 flex-1"><h2 className="text-lg font-semibold text-white">{title}</h2>{description ? <p className="mt-1 text-sm leading-5 text-neutral-500">{description}</p> : null}</div><button type="button" onClick={onClose} aria-label="Close" className="rounded-md px-2 py-1 text-xl text-neutral-500 hover:bg-neutral-900 hover:text-white">×</button></div>
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

function OkrHeader({ workspaceSlug, okr, ownerOptions, pending, run, runWithoutForm, onComplete }: {
    workspaceSlug: string
    okr: WorkspaceOkr
    ownerOptions: Person[]
    pending: boolean
    run: (event: FormEvent<HTMLFormElement>, action: (formData: FormData) => Promise<void>) => void
    runWithoutForm: (action: () => Promise<void>) => void
    onComplete: () => void
}) {
    const [dirty, setDirty] = useState(false)
    const draft = okr.status === "draft"
    const active = okr.status === "active"
    const editable = draft || active
    return <form onSubmit={(event) => run(event, draft ? updateOkr.bind(null, workspaceSlug, okr.id) : updateActiveOkrDetails.bind(null, workspaceSlug, okr.id))} onChange={() => setDirty(true)} className="px-3 py-3 sm:px-4">
        <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2"><span className="font-mono text-xs text-neutral-600">OKR-{shortId(okr.id)}</span><Status label={okr.status} tone={statusTone(okr.status)} /></div>
                {draft ? <div className="mt-1.5 flex flex-wrap items-center gap-x-1 gap-y-0.5 text-lg font-semibold leading-6 text-neutral-100"><span className="shrink-0">Draft Objective:</span><input name="objective" required defaultValue={okr.objective} aria-label="Objective" className={`${editorClass} min-w-[12rem] flex-1 text-lg font-semibold`} /><span className="flex basis-full items-center gap-1 sm:basis-auto"><span className="shrink-0 text-neutral-500">by</span><input name="period_end" type="date" required defaultValue={okr.period_end} aria-label="Deadline" className={`${editorClass} w-auto text-sm font-medium`} /></span></div> : <h2 className="mt-1.5 text-lg font-semibold leading-6 tracking-tight text-neutral-100">{okrDisplayTitle({ objectiveType: okr.objective_type, objective: okr.objective, deadline: okr.period_end })}</h2>}
                <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-neutral-600">
                    {editable ? <label className="flex items-center gap-1"><span>Owner</span><select name="owner_user_id" defaultValue={okr.owner_user_id} className={`${editorClass} w-auto py-0 text-xs text-neutral-400`}>{ownerOptions.map((person) => <option key={person.user_id} value={person.user_id}>{person.name}</option>)}</select></label> : <span>{ownerOptions.find((person) => person.user_id === okr.owner_user_id)?.name ?? "Admin"}</span>}
                    {draft ? <label className="flex items-center gap-1"><span>Starts</span><input name="period_start" type="date" required defaultValue={okr.period_start} className={`${editorClass} w-auto py-0 text-xs text-neutral-400`} /></label> : <span>{formatOkrDeadline(okr.period_start)} → {formatOkrDeadline(okr.period_end)}</span>}
                    <span>{okr.key_results.length} KR{okr.key_results.length === 1 ? "" : "s"}</span>
                    <span>Updated {formatRelativeTime(okr.updated_at)}</span>
                </div>
                {editable ? <textarea name="description" rows={1} defaultValue={okr.description ?? ""} placeholder="Add Objective context…" className={`${editorClass} mt-1 resize-none text-sm leading-5 text-neutral-500 focus:min-h-16`} /> : <DescriptionText text={okr.description} className="mt-1.5" />}
            </div>
            <div className="flex shrink-0 items-center gap-2"><ProgressRing progress={okr.attainment} />{draft ? <div className="flex flex-col items-end gap-1"><button type="button" disabled={pending} onClick={() => runWithoutForm(() => commitOkr(workspaceSlug, okr.id))} className="h-8 rounded-md bg-white px-2.5 text-xs font-medium text-black disabled:opacity-50">Commit</button><button type="button" disabled={pending} onClick={() => runWithoutForm(() => deleteOkr(workspaceSlug, okr.id))} className="text-[11px] text-red-300/60 hover:text-red-200">Delete</button></div> : active ? <button type="button" onClick={onComplete} className="h-8 rounded-md border border-neutral-800 px-2.5 text-xs text-neutral-300 hover:border-neutral-600 hover:text-white">Complete</button> : null}</div>
        </div>
        {editable && dirty ? <div className="mt-2 flex justify-end gap-2"><button type="button" onClick={(event) => { event.currentTarget.form?.reset(); setDirty(false) }} className="h-7 px-2 text-xs text-neutral-500 hover:text-white">Cancel</button><button disabled={pending} className="h-7 rounded-md bg-white px-2.5 text-xs font-medium text-black disabled:opacity-50">{pending ? "Saving…" : "Save"}</button></div> : null}
    </form>
}

function DraftKeyResultBody({ workspaceSlug, okr, result, pending, run, runWithoutForm }: {
    workspaceSlug: string
    okr: WorkspaceOkr
    result: OkrKeyResult
    pending: boolean
    run: (event: FormEvent<HTMLFormElement>, action: (formData: FormData) => Promise<void>) => void
    runWithoutForm: (action: () => Promise<void>) => void
}) {
    const [dirty, setDirty] = useState(false)
    const [unit, setUnit] = useState(result.unit)
    return <form onSubmit={(event) => run(event, updateOkrKeyResult.bind(null, workspaceSlug, okr.id, result.id))} onChange={() => setDirty(true)} onReset={() => { setDirty(false); setUnit(result.unit) }} className="border-t border-neutral-900 bg-neutral-950/30 px-3 py-3 sm:px-4">
        <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-6">
            <label className="text-[11px] uppercase tracking-wide text-neutral-600 md:col-span-2 xl:col-span-2">Key Result<input name="name" required defaultValue={result.name} className={`${editorClass} mt-0.5 -ml-2 text-sm font-medium`} /></label>
            <label className="text-[11px] uppercase tracking-wide text-neutral-600">Base<input name="baseline_value" type="number" step="any" required defaultValue={result.baseline_value} className={`${editorClass} mt-0.5 -ml-2`} /></label>
            <label className="text-[11px] uppercase tracking-wide text-neutral-600">Target<input name="target_value" type="number" step="any" required defaultValue={result.target_value} className={`${editorClass} mt-0.5 -ml-2`} /></label>
            <label className="text-[11px] uppercase tracking-wide text-neutral-600">Unit<select name="unit" value={unit} onChange={(event) => setUnit(event.target.value as OkrKeyResult["unit"])} className={`${editorClass} mt-0.5 -ml-2`}><option value="number">Number</option><option value="percentage">Percentage</option><option value="currency">Currency</option><option value="duration">Duration</option></select></label>
            <label className="text-[11px] uppercase tracking-wide text-neutral-600">Direction<select name="comparator" defaultValue={result.comparator} className={`${editorClass} mt-0.5 -ml-2`}><option value="at_least">Higher</option><option value="at_most">Lower</option></select></label>
            <label className="text-[11px] uppercase tracking-wide text-neutral-600 md:col-span-2 xl:col-span-2">Cadence<select name="reporting_cadence" required defaultValue={result.reporting_cadence ?? ""} className={`${editorClass} mt-0.5 -ml-2`}><option value="" disabled>Choose cadence…</option><option value="daily">Daily</option><option value="weekly">Weekly</option><option value="manual">Manual</option></select></label>
            {unit === "currency" ? <label className="text-[11px] uppercase tracking-wide text-neutral-600">Currency<input name="currency_code" defaultValue={result.currency_code ?? "USD"} maxLength={3} className={`${editorClass} mt-0.5 -ml-2 uppercase`} /></label> : null}
            <label className="text-[11px] uppercase tracking-wide text-neutral-600 md:col-span-2 xl:col-span-4">Description<textarea name="description" rows={1} defaultValue={result.description ?? ""} placeholder="Add KR context…" className={`${editorClass} mt-0.5 -ml-2 resize-none`} /></label>
        </div>
        <div className="mt-2 flex items-center justify-between"><p className="text-xs text-neutral-700">Work can be linked after commitment.</p><div className="flex items-center gap-1">{dirty ? <button disabled={pending} className="h-7 rounded-md bg-white px-2.5 text-xs font-medium text-black disabled:opacity-50">{pending ? "Saving…" : "Save KR"}</button> : null}<button type="button" disabled={pending} onClick={() => runWithoutForm(() => deleteOkrKeyResult(workspaceSlug, okr.id, result.id))} className="h-7 px-2 text-xs text-red-300/70 hover:text-red-200">Delete</button></div></div>
    </form>
}

function TrendChart({ result, days }: { result: OkrKeyResult; days: OkrReportingDay<OkrMeasurement>[] }) {
    const plotted = days.flatMap((day, index) => day.measurement ? [{ index, value: day.measurement.value }] : [])
    const values = [result.baseline_value, result.target_value, ...plotted.map((point) => point.value)]
    const rawMin = Math.min(...values)
    const rawMax = Math.max(...values)
    const span = rawMax - rawMin || 1
    const min = rawMin - span * 0.08
    const max = rawMax + span * 0.08
    const x = (index: number) => 8 + index * (304 / Math.max(1, days.length - 1))
    const y = (value: number) => 82 - ((value - min) / (max - min)) * 70
    const points = plotted.map((point) => `${x(point.index)},${y(point.value)}`).join(" ")
    return <div className="min-w-0">
        <div className="mb-1 flex items-center justify-between text-[11px] text-neutral-600"><span>35-day trend</span><span>Target {formatOkrMetricValue(result.target_value, result.unit, result.currency_code ?? "USD")}</span></div>
        <svg viewBox="0 0 320 90" className="h-[90px] w-full overflow-visible" role="img" aria-label={`${result.name} measurement trend`}>
            <line x1="8" x2="312" y1={y(result.target_value)} y2={y(result.target_value)} stroke="rgb(82 82 82)" strokeDasharray="4 4" />
            {plotted.length > 1 ? <polyline points={points} fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /> : null}
            {plotted.map((point) => <circle key={point.index} cx={x(point.index)} cy={y(point.value)} r="3" fill="white" />)}
        </svg>
        {!plotted.length ? <p className="-mt-12 text-center text-xs text-neutral-700">No reports in this window</p> : null}
    </div>
}

function AccountabilityTracker({ result, people, today, onRecord }: { result: OkrKeyResult; people: Record<string, string>; today: string; onRecord: () => void }) {
    const days = useMemo(() => buildOkrReportingDays({ cadence: result.reporting_cadence, reportingStartedOn: result.reporting_started_on, measurements: result.measurements, today }), [result.measurements, result.reporting_cadence, result.reporting_started_on, today])
    const [selectedDate, setSelectedDate] = useState<string | null>(null)
    const selected = selectedDate ? days.find((day) => day.date === selectedDate) ?? null : null
    const measurements = [...result.measurements].sort((left, right) => left.reported_on.localeCompare(right.reported_on) || left.measured_at.localeCompare(right.measured_at))
    const selectedIndex = selected?.measurement ? measurements.findIndex((measurement) => measurement.id === selected.measurement?.id) : -1
    const previous = selectedIndex > 0 ? measurements[selectedIndex - 1] : null
    const weekdayLabels = days.slice(0, 7).map((day) => new Intl.DateTimeFormat("en-IE", { weekday: "narrow", timeZone: "UTC" }).format(new Date(`${day.date}T00:00:00Z`)))
    const stateClass: Record<OkrReportingDay["state"], string> = {
        reported: "border-white bg-white text-black",
        due: "border-amber-500/70 bg-amber-500/10 text-amber-200",
        missed: "border-red-700/70 bg-red-950/40 text-red-300",
        before: "border-neutral-900 text-neutral-800",
        future: "border-neutral-900 text-neutral-800",
        none: "border-neutral-800 text-neutral-700",
    }
    return <section className="border-t border-neutral-900 bg-black/40 px-3 py-3 sm:px-4">
        <div className="mb-3 flex items-center justify-between gap-3"><div><p className="text-xs font-medium text-neutral-300">Accountability</p><p className="mt-0.5 text-[11px] text-neutral-600">{okrReportingCadenceLabel(result.reporting_cadence)} reporting · trailing 35 days</p></div><button type="button" onClick={onRecord} className="h-8 rounded-md border border-neutral-800 px-2.5 text-xs text-neutral-300 hover:border-neutral-600 hover:text-white">Record progress</button></div>
        <div className="grid gap-4 md:grid-cols-[300px_minmax(300px,1fr)] md:items-start">
            <div className="min-w-0 max-w-[18rem]"><div className="grid grid-cols-7 gap-1">{weekdayLabels.map((label, index) => <span key={`${label}-${index}`} className="pb-0.5 text-center text-[10px] text-neutral-700">{label}</span>)}{days.map((day) => <button key={day.date} type="button" disabled={!day.measurement} onClick={() => setSelectedDate(day.date)} aria-label={`${day.date}: ${day.state}${day.reportCount > 1 ? `, ${day.reportCount} reports` : ""}`} className={`aspect-square min-h-6 rounded border text-[10px] tabular-nums transition ${stateClass[day.state]} ${day.measurement ? "cursor-pointer hover:ring-2 hover:ring-neutral-500" : "cursor-default"}`}>{Number(day.date.slice(-2))}</button>)}</div><div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-neutral-600"><span><i className="mr-1 inline-block h-2 w-2 rounded-sm bg-white" />Reported</span><span><i className="mr-1 inline-block h-2 w-2 rounded-sm border border-amber-500/70" />Due</span><span><i className="mr-1 inline-block h-2 w-2 rounded-sm border border-red-700/70" />Missed</span></div></div>
            <TrendChart result={result} days={days} />
        </div>
        {selected?.measurement ? <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-neutral-900 pt-2 text-xs text-neutral-500"><span className="font-medium text-neutral-200">{formatOkrDeadline(selected.date)}</span><span>{formatOkrMetricValue(selected.measurement.value, result.unit, result.currency_code ?? "USD")}</span>{previous ? <span>{selected.measurement.value - previous.value >= 0 ? "+" : ""}{formatOkrMetricValue(selected.measurement.value - previous.value, result.unit, result.currency_code ?? "USD")} from prior</span> : null}<span>{people[selected.measurement.recorded_by ?? ""] ?? "Admin"}</span><span>{new Date(selected.measurement.measured_at).toLocaleString("en-IE", { dateStyle: "medium", timeStyle: "short" })}</span>{selected.reportCount > 1 ? <span>{selected.reportCount} reports that day</span> : null}{selected.measurement.note ? <span className="basis-full text-neutral-400">{selected.measurement.note}</span> : null}</div> : null}
    </section>
}

function WorkItems({ workspaceSlug, okr, result, people, onAdd, onUnlink }: { workspaceSlug: string; okr: WorkspaceOkr; result: OkrKeyResult; people: Record<string, string>; onAdd: () => void; onUnlink: (workItemId: string) => void }) {
    return <section className="ml-4 border-t border-neutral-900 sm:ml-8">
        <div className="flex items-center justify-between gap-3 px-3 py-2 sm:px-4"><p className="text-[11px] font-medium uppercase tracking-wide text-neutral-600">Work items <span className="ml-1 tabular-nums text-neutral-700">{result.actions.length}</span></p>{okr.status === "active" ? <button type="button" onClick={onAdd} className="h-7 rounded-md border border-neutral-800 px-2 text-xs text-neutral-400 hover:border-neutral-600 hover:text-white">Add work</button> : null}</div>
        {result.actions.length ? <div className="divide-y divide-neutral-900 border-t border-neutral-900">{result.actions.map((action) => {
            const assignees = action.assignee_ids.map((id) => people[id] ?? "Team member")
            const actions = [okr.status === "active" ? { label: "Unlink from Key Result", action: () => onUnlink(action.id), danger: true, confirmMessage: "Unlink this work item from the Key Result? The work item itself will remain." } : null]
            return <div key={action.id} className="px-3 py-2 sm:px-4">
                <div className="xl:hidden">
                    <div className="flex min-w-0 items-center gap-2"><Link href={`/${workspaceSlug}/work-items/${action.id}`} className="min-w-0 flex-1 truncate text-sm font-medium text-neutral-200 hover:text-white hover:underline hover:decoration-neutral-600 hover:underline-offset-4">{action.title}</Link><RoundPill tone={priorityTone(action.priority)}>{workItemPriorityLabel(action.priority)}</RoundPill><SquarePill tone={workStatusTone(action.status)} className="shrink-0 capitalize">{action.status.replace(/_/g, " ")}</SquarePill><ListActionMenu label={`Actions for ${action.title}`} actions={actions} /></div>
                    <DescriptionText text={action.description} className="mt-0.5" />
                    <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-neutral-600"><span className="font-mono text-neutral-700">{shortId(action.id)}</span><span>{assignees.length ? assignees.join(", ") : "Unassigned"}</span><span>Added {formatRelativeTime(action.created_at)}</span><span>Due {displayDate(action.due_date)}</span></div>
                </div>
                <div className="hidden min-h-10 grid-cols-[minmax(240px,1fr)_auto_auto_minmax(100px,auto)_auto_auto_32px] items-center gap-3 xl:grid">
                    <div className="min-w-0"><Link href={`/${workspaceSlug}/work-items/${action.id}`} className="block truncate text-sm font-medium text-neutral-200 hover:text-white hover:underline hover:decoration-neutral-600 hover:underline-offset-4">{action.title}</Link><DescriptionText text={action.description} className="mt-0.5" /></div>
                    <RoundPill tone={priorityTone(action.priority)}>{workItemPriorityLabel(action.priority)}</RoundPill>
                    <SquarePill tone={workStatusTone(action.status)} className="capitalize">{action.status.replace(/_/g, " ")}</SquarePill>
                    <span className="truncate text-xs text-neutral-600">{assignees.length ? assignees.join(", ") : "Unassigned"}</span>
                    <span className="whitespace-nowrap text-xs text-neutral-600">Added {formatRelativeTime(action.created_at)}</span>
                    <span className="whitespace-nowrap text-xs text-neutral-600">Due {displayDate(action.due_date)}</span>
                    <ListActionMenu label={`Actions for ${action.title}`} actions={actions} />
                </div>
            </div>
        })}</div> : <p className="border-t border-neutral-900 px-3 py-3 text-sm text-neutral-700 sm:px-4">No work items linked.</p>}
    </section>
}

function ActiveDescription({ workspaceSlug, okr, result, pending, run }: { workspaceSlug: string; okr: WorkspaceOkr; result: OkrKeyResult; pending: boolean; run: (event: FormEvent<HTMLFormElement>, action: (formData: FormData) => Promise<void>) => void }) {
    const [dirty, setDirty] = useState(false)
    if (okr.status !== "active") return <DescriptionText text={result.description} className="border-t border-neutral-900 px-3 py-2 sm:px-4" />
    return <form onSubmit={(event) => run(event, updateActiveOkrKeyResultDescription.bind(null, workspaceSlug, okr.id, result.id))} onChange={() => setDirty(true)} className="flex items-start gap-2 border-t border-neutral-900 px-3 py-2 sm:px-4"><textarea name="description" rows={1} defaultValue={result.description ?? ""} placeholder="Add KR context…" className={`${editorClass} min-w-0 flex-1 resize-none text-neutral-500`} />{dirty ? <button disabled={pending} className="mt-0.5 h-7 rounded-md bg-white px-2.5 text-xs font-medium text-black disabled:opacity-50">Save</button> : null}</form>
}

function LegacyCadenceSetup({ workspaceSlug, okr, result, pending, run }: { workspaceSlug: string; okr: WorkspaceOkr; result: OkrKeyResult; pending: boolean; run: (event: FormEvent<HTMLFormElement>, action: (formData: FormData) => Promise<void>) => void }) {
    return <form onSubmit={(event) => run(event, setOkrKeyResultCadence.bind(null, workspaceSlug, okr.id, result.id))} className="flex flex-col gap-2 border-t border-neutral-900 bg-amber-500/5 px-3 py-3 sm:flex-row sm:items-center sm:px-4"><div className="min-w-0 flex-1"><p className="text-sm font-medium text-neutral-200">Set reporting cadence</p><p className="mt-0.5 text-xs text-neutral-600">This one-time choice starts accountability today and locks permanently.</p></div><select name="reporting_cadence" required defaultValue="" className="h-8 rounded-md border border-neutral-700 bg-black px-2 text-xs text-neutral-200"><option value="" disabled>Choose cadence…</option><option value="daily">Daily</option><option value="weekly">Weekly</option><option value="manual">Manual</option></select><button disabled={pending} className="h-8 rounded-md bg-white px-2.5 text-xs font-medium text-black disabled:opacity-50">Set cadence</button></form>
}

export function OkrWorkspace({ workspaceSlug, okrs, ownerOptions, workItems, people, today }: Props) {
    const router = useRouter()
    const [dialog, setDialog] = useState<DialogState | null>(null)
    const [error, setError] = useState<string | null>(null)
    const [completionId, setCompletionId] = useState<string | null>(null)
    const [toggledIds, setToggledIds] = useState<Set<string>>(() => new Set())
    const [pending, startTransition] = useTransition()

    function run(event: FormEvent<HTMLFormElement>, action: (formData: FormData) => Promise<void>, close = false) {
        event.preventDefault()
        const formData = new FormData(event.currentTarget)
        setError(null)
        startTransition(async () => {
            try { await action(formData); if (close) setDialog(null); router.refresh() }
            catch (cause) { setError(cause instanceof Error ? cause.message : "This change could not be saved") }
        })
    }

    function runWithoutForm(action: () => Promise<void>) {
        setError(null)
        startTransition(async () => {
            try { await action(); router.refresh() }
            catch (cause) { setError(cause instanceof Error ? cause.message : "This change could not be saved") }
        })
    }

    if (!okrs.length) return <section className="mt-5 rounded-xl border border-dashed border-neutral-800 bg-black px-5 py-9 text-center"><p className="font-medium text-neutral-200">No committed Objectives or drafts yet.</p><p className="mt-1 text-sm text-neutral-500">Use Add OKR from the workspace actions to create the first draft.</p></section>

    return <div className="mt-5">
        {error ? <div role="alert" className="mb-3 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-200">{error}</div> : null}
        <div className="overflow-hidden rounded-xl border border-neutral-800 bg-black">{okrs.map((okr) => {
            const draft = okr.status === "draft"
            return <section id={`okr-${okr.id}`} key={okr.id} className="scroll-mt-28 border-b border-neutral-800 last:border-0">
                <OkrHeader key={okr.updated_at} workspaceSlug={workspaceSlug} okr={okr} ownerOptions={ownerOptions} pending={pending} run={run} runWithoutForm={runWithoutForm} onComplete={() => setCompletionId((current) => current === okr.id ? null : okr.id)} />
                {completionId === okr.id ? <form onSubmit={(event) => run(event, (formData) => setOkrStatus(workspaceSlug, okr.id, "completed", formData))} className="flex flex-col gap-2 border-t border-neutral-900 bg-neutral-950/50 px-3 py-2.5 sm:flex-row sm:px-4"><textarea name="outcome_note" required rows={2} autoFocus placeholder="Record the outcome and final assessment…" className={`${modalTextareaClass} mt-0 flex-1`} /><button disabled={pending} className="h-9 self-end rounded-md bg-white px-3 text-xs font-medium text-black disabled:opacity-50">Confirm completion</button></form> : null}
                {okr.outcome_note ? <p className="border-t border-neutral-900 px-3 py-2 text-sm leading-5 text-neutral-500 sm:px-4"><span className="mr-2 text-[11px] uppercase tracking-wide text-neutral-700">Outcome</span>{okr.outcome_note}</p> : null}
                <div className="flex items-center justify-between gap-3 border-t border-neutral-800 bg-neutral-950/40 px-3 py-2 sm:px-4"><p className="text-xs font-medium text-neutral-400">Key Results <span className="ml-1 tabular-nums text-neutral-700">{okr.key_results.length}</span></p>{draft ? <button type="button" onClick={() => setDialog({ type: "add-result", okr })} className="h-7 rounded-md border border-neutral-800 px-2 text-xs text-neutral-400 hover:border-neutral-600 hover:text-white">Add KR</button> : null}</div>
                <div>{okr.key_results.length ? okr.key_results.map((result) => {
                    const expanded = draft ? !toggledIds.has(result.id) : toggledIds.has(result.id)
                    const currency = result.currency_code ?? "USD"
                    const latest = result.measurements.at(-1)
                    const gap = okrGap(result.comparator, result.current_value, result.target_value)
                    return <article id={`key-result-${result.id}`} key={result.id} className="ml-3 scroll-mt-28 border-t border-neutral-900 first:border-t-0 sm:ml-6">
                        <div className="flex items-start gap-2 px-3 py-2.5 sm:px-4">
                            <button type="button" onClick={() => setToggledIds((current) => { const next = new Set(current); if (next.has(result.id)) next.delete(result.id); else next.add(result.id); return next })} aria-expanded={expanded} aria-label={`${expanded ? "Collapse" : "Expand"} ${result.name}`} className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded text-neutral-600 hover:bg-neutral-900 hover:text-white"><span className={`transition-transform ${expanded ? "rotate-90" : ""}`}>›</span></button>
                            <div className="min-w-0 flex-1"><div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1"><span className="font-mono text-[11px] text-neutral-700">KR-{shortId(result.id)}</span><h3 className="min-w-0 truncate text-sm font-medium text-neutral-100">{result.name}</h3><SquarePill tone={result.reporting_cadence ? "neutral" : "yellow"}>{okrReportingCadenceLabel(result.reporting_cadence)}</SquarePill></div><DescriptionText text={result.description} className="mt-0.5" /><div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-neutral-600"><span>{formatOkrMetricValue(result.current_value, result.unit, currency)} → {formatOkrMetricValue(result.target_value, result.unit, currency)}</span><span className="font-medium text-neutral-300">{Math.round(result.progress)}%</span><span>{result.actions.length} work item{result.actions.length === 1 ? "" : "s"}</span><span>{latest ? `Reported ${formatRelativeTime(latest.measured_at)}` : "No reports"}</span></div></div>
                        </div>
                        {expanded ? <div>{draft ? <DraftKeyResultBody key={`${result.id}-${result.name}-${result.description}-${result.baseline_value}-${result.target_value}-${result.unit}-${result.comparator}-${result.reporting_cadence}`} workspaceSlug={workspaceSlug} okr={okr} result={result} pending={pending} run={run} runWithoutForm={runWithoutForm} /> : <><ActiveDescription key={`${result.id}-${result.description}`} workspaceSlug={workspaceSlug} okr={okr} result={result} pending={pending} run={run} />{okr.status === "active" && !result.reporting_cadence ? <LegacyCadenceSetup workspaceSlug={workspaceSlug} okr={okr} result={result} pending={pending} run={run} /> : result.reporting_cadence && result.reporting_started_on ? <AccountabilityTracker result={result} people={people} today={today} onRecord={() => setDialog({ type: "measurement", okr, result })} /> : null}<div className="grid border-t border-neutral-900 grid-cols-2 sm:grid-cols-4"><div className="px-3 py-2"><p className="text-[10px] uppercase tracking-wide text-neutral-700">Base</p><p className="mt-0.5 text-sm text-neutral-300">{formatOkrMetricValue(result.baseline_value, result.unit, currency)}</p></div><div className="border-l border-neutral-900 px-3 py-2"><p className="text-[10px] uppercase tracking-wide text-neutral-700">Current</p><p className="mt-0.5 text-sm text-neutral-300">{formatOkrMetricValue(result.current_value, result.unit, currency)}</p></div><div className="border-t border-neutral-900 px-3 py-2 sm:border-l sm:border-t-0"><p className="text-[10px] uppercase tracking-wide text-neutral-700">Target</p><p className="mt-0.5 text-sm text-neutral-300">{formatOkrMetricValue(result.target_value, result.unit, currency)}</p></div><div className="border-l border-t border-neutral-900 px-3 py-2 sm:border-t-0"><p className="text-[10px] uppercase tracking-wide text-neutral-700">{result.target_met ? "Result" : "Remaining"}</p><p className="mt-0.5 text-sm text-neutral-300">{result.target_met ? "Target reached" : formatOkrMetricValue(gap, result.unit, currency)}</p></div></div><WorkItems workspaceSlug={workspaceSlug} okr={okr} result={result} people={people} onAdd={() => setDialog({ type: "add-work", okr, result })} onUnlink={(workItemId) => runWithoutForm(() => unlinkOkrAction(workspaceSlug, okr.id, result.id, workItemId))} /></>}</div> : null}
                    </article>
                }) : <div className="ml-3 px-3 py-5 text-sm text-neutral-700 sm:ml-6 sm:px-4">No Key Results yet.{draft ? " Add the first measurable result before committing." : ""}</div>}</div>
            </section>
        })}</div>

        {dialog?.type === "add-result" ? <Modal title="Add Key Result" description="Define the starting point, target, and reporting cadence." onClose={() => setDialog(null)}><form onSubmit={(event) => run(event, addOkrKeyResult.bind(null, workspaceSlug, dialog.okr.id), true)} className="p-5"><NewKeyResultFields /><div className="mt-5 flex justify-end"><button disabled={pending} className="h-10 rounded-lg bg-white px-4 text-sm font-medium text-black disabled:opacity-50">{pending ? "Adding…" : "Add Key Result"}</button></div></form></Modal> : null}
        {dialog?.type === "measurement" ? <Modal title={`Record progress for KR-${shortId(dialog.result.id)}`} description={`${dialog.result.name} · current ${formatOkrMetricValue(dialog.result.current_value, dialog.result.unit, dialog.result.currency_code ?? "USD")}`} onClose={() => setDialog(null)}><form onSubmit={(event) => run(event, addOkrMeasurement.bind(null, workspaceSlug, dialog.okr.id, dialog.result.id), true)} className="grid gap-3 p-5 sm:grid-cols-2"><label className="text-sm text-neutral-300">Current value<input name="value" type="number" step="any" required autoFocus defaultValue={dialog.result.current_value} className={modalInputClass} /></label><label className="text-sm text-neutral-300">Report date<input name="reported_on" type="date" required defaultValue={today} className={modalInputClass} /></label><label className="text-sm text-neutral-300 sm:col-span-2">Note <span className="text-neutral-600">(optional)</span><textarea name="note" rows={2} className={modalTextareaClass} /></label><div className="flex justify-end sm:col-span-2"><button disabled={pending} className="h-10 rounded-lg bg-white px-4 text-sm font-medium text-black disabled:opacity-50">{pending ? "Recording…" : "Record progress"}</button></div></form></Modal> : null}
        {dialog?.type === "add-work" ? (() => {
            const linkedIds = new Set(dialog.result.actions.map((action) => action.id))
            const available = workItems.filter((item) => !linkedIds.has(item.id))
            return <Modal title={`Add work to KR-${shortId(dialog.result.id)}`} description="Create a private Admin work item or link existing work from this workspace." onClose={() => setDialog(null)}><div className="grid gap-5 p-5 md:grid-cols-2"><form onSubmit={(event) => run(event, createOkrAction.bind(null, workspaceSlug, dialog.okr.id, dialog.result.id), true)}><h3 className="font-medium">Create work item</h3><label className="mt-3 block text-sm text-neutral-300">Title<input name="title" required autoFocus placeholder="What needs to happen?" className={modalInputClass} /></label><label className="mt-3 block text-sm text-neutral-300">Description <span className="text-neutral-600">(optional)</span><textarea name="description" rows={3} className={modalTextareaClass} /></label><button disabled={pending} className="mt-4 h-10 w-full rounded-lg bg-white px-3 text-sm font-medium text-black disabled:opacity-50">Create and link</button></form><form onSubmit={(event) => run(event, linkOkrAction.bind(null, workspaceSlug, dialog.okr.id, dialog.result.id), true)} className="border-t border-neutral-800 pt-5 md:border-l md:border-t-0 md:pl-5 md:pt-0"><h3 className="font-medium">Link existing work</h3>{available.length ? <><label className="mt-3 block text-sm text-neutral-300">Work item<select name="work_item_id" className={modalInputClass}>{available.map((item) => <option key={item.id} value={item.id}>{item.title} · {workItemPriorityLabel(item.priority)}</option>)}</select></label><button disabled={pending} className="mt-4 h-10 w-full rounded-lg border border-neutral-700 px-3 text-sm text-neutral-200 disabled:opacity-50">Link work item</button></> : <p className="mt-3 text-sm leading-6 text-neutral-600">Every available work item is already linked to this Key Result.</p>}</form></div></Modal>
        })() : null}
    </div>
}
