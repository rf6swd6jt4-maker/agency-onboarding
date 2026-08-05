"use client"

import Link from "next/link"
import { createPortal } from "react-dom"
import { useState, useTransition, type FormEvent, type ReactNode } from "react"
import { useRouter } from "next/navigation"
import { RoundPill, SquarePill, Status } from "@/components/ui"
import { formatOkrMetricValue, okrGap } from "@/lib/admin/okr-metrics"
import type { OkrKeyResult, WorkspaceOkr } from "@/lib/admin/okrs"
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
    setOkrStatus,
    unlinkOkrAction,
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
}

const editorClass = "w-full rounded-md border border-transparent bg-transparent px-2 py-1.5 text-sm text-neutral-200 outline-none transition hover:border-neutral-800 hover:bg-neutral-950 focus:border-neutral-600 focus:bg-neutral-950 disabled:cursor-default disabled:hover:border-transparent disabled:hover:bg-transparent"
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

function Field({ label, children, wide = false }: { label: string; children: ReactNode; wide?: boolean }) {
    return <div className={`grid min-h-11 grid-cols-[6.5rem_minmax(0,1fr)] items-start gap-2 border-b border-neutral-900 py-1.5 sm:grid-cols-[7.5rem_minmax(0,1fr)] ${wide ? "lg:col-span-2" : ""}`}><p className="px-1 pt-2 text-xs text-neutral-600">{label}</p><div className="min-w-0">{children}</div></div>
}

function Metric({ label, children }: { label: string; children: ReactNode }) {
    return <div className="min-w-0 border-t border-neutral-900 px-3 py-2.5 sm:border-l sm:border-t-0 sm:first:border-l-0"><p className="text-[11px] uppercase tracking-wide text-neutral-600">{label}</p><div className="mt-1 min-w-0 text-sm font-medium text-neutral-200">{children}</div></div>
}

function ProgressRing({ progress, size = "md" }: { progress: number; size?: "sm" | "md" }) {
    const bounded = Math.max(0, Math.min(100, progress))
    const circumference = 2 * Math.PI * 25
    const dimensions = size === "sm" ? "h-14 w-14" : "h-16 w-16"
    return <div className={`relative shrink-0 ${dimensions}`} aria-label={`${Math.round(bounded)} percent attained`}>
        <svg viewBox="0 0 64 64" className="h-full w-full -rotate-90" aria-hidden="true"><circle cx="32" cy="32" r="25" fill="none" stroke="rgb(38 38 38)" strokeWidth="4.5" /><circle cx="32" cy="32" r="25" fill="none" stroke="white" strokeWidth="4.5" strokeLinecap="round" strokeDasharray={circumference} strokeDashoffset={circumference * (1 - bounded / 100)} /></svg>
        <span className="absolute inset-0 flex items-center justify-center text-xs font-semibold tabular-nums text-white">{Math.round(bounded)}%</span>
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
        {unit === "currency" ? <label className="text-sm text-neutral-300 sm:col-span-2">Currency code<input name="currency_code" defaultValue="USD" maxLength={3} className={`${modalInputClass} uppercase`} /></label> : null}
    </div>
}

function OkrDefinition({ okr, ownerOptions, pending, onSubmit }: { okr: WorkspaceOkr; ownerOptions: Person[]; pending: boolean; onSubmit: (event: FormEvent<HTMLFormElement>) => void }) {
    const [dirty, setDirty] = useState(false)
    const draft = okr.status === "draft"
    return <form onSubmit={onSubmit} onChange={() => setDirty(true)} className="grid border-t border-neutral-900 px-4 sm:px-5 lg:grid-cols-2 lg:gap-x-8">
        <Field label="Objective"><textarea name="objective" rows={2} required defaultValue={okr.objective} disabled={!draft} className={`${editorClass} resize-none leading-5`} /></Field>
        <Field label="Owner"><select name="owner_user_id" defaultValue={okr.owner_user_id} disabled={!draft} className={editorClass}>{ownerOptions.map((person) => <option key={person.user_id} value={person.user_id}>{person.name} · {person.role}</option>)}</select></Field>
        <Field label="Starts"><input name="period_start" type="date" required defaultValue={okr.period_start} disabled={!draft} className={editorClass} /></Field>
        <Field label="Deadline"><input name="period_end" type="date" required defaultValue={okr.period_end} disabled={!draft} className={editorClass} /></Field>
        <Field label="Description" wide><textarea name="description" rows={2} defaultValue={okr.description ?? ""} disabled={!draft} placeholder={draft ? "Add context for the team…" : "No description"} className={`${editorClass} resize-none leading-5`} /></Field>
        {draft && dirty ? <div className="flex justify-end gap-2 py-2 lg:col-span-2"><button type="button" onClick={(event) => { event.currentTarget.form?.reset(); setDirty(false) }} className="h-8 px-2 text-xs text-neutral-500 hover:text-white">Cancel</button><button disabled={pending} className="h-8 rounded-md bg-white px-3 text-xs font-medium text-black disabled:opacity-50">{pending ? "Saving…" : "Save Objective"}</button></div> : null}
    </form>
}

function DraftKeyResult({ workspaceSlug, okr, result, pending, run, runWithoutForm }: {
    workspaceSlug: string
    okr: WorkspaceOkr
    result: OkrKeyResult
    pending: boolean
    run: (event: FormEvent<HTMLFormElement>, action: (formData: FormData) => Promise<void>) => void
    runWithoutForm: (action: () => Promise<void>) => void
}) {
    const [dirty, setDirty] = useState(false)
    const [unit, setUnit] = useState(result.unit)
    return <form id={`key-result-${result.id}`} onSubmit={(event) => run(event, updateOkrKeyResult.bind(null, workspaceSlug, okr.id, result.id))} onChange={() => setDirty(true)} onReset={() => { setDirty(false); setUnit(result.unit) }} className="scroll-mt-28">
        <div className="grid gap-4 px-4 py-4 sm:px-5 lg:grid-cols-[minmax(0,1fr)_auto]">
            <div className="min-w-0"><div className="flex items-center gap-2"><p className="font-mono text-xs text-neutral-600">KR-{shortId(result.id)}</p><SquarePill tone="neutral">Draft</SquarePill></div><input name="name" required defaultValue={result.name} aria-label="Key Result name" className={`${editorClass} mt-1 text-base font-semibold`} /><textarea name="description" rows={1} defaultValue={result.description ?? ""} aria-label="Key Result description" placeholder="Add a description…" className={`${editorClass} mt-0.5 resize-none text-sm leading-5 text-neutral-500`} /></div>
            <ProgressRing progress={result.progress} size="sm" />
        </div>
        <div className="grid border-t border-neutral-900 sm:grid-cols-4">
            <Metric label="Base"><input name="baseline_value" type="number" step="any" required defaultValue={result.baseline_value} aria-label="Base value" className={`${editorClass} -ml-2 font-medium`} /></Metric>
            <Metric label="Target"><input name="target_value" type="number" step="any" required defaultValue={result.target_value} aria-label="Target value" className={`${editorClass} -ml-2 font-medium`} /></Metric>
            <Metric label="Unit"><select name="unit" value={unit} onChange={(event) => setUnit(event.target.value as OkrKeyResult["unit"])} aria-label="Metric unit" className={`${editorClass} -ml-2`}><option value="number">Number</option><option value="percentage">Percentage</option><option value="currency">Currency</option><option value="duration">Duration (hours)</option></select>{unit === "currency" ? <input name="currency_code" defaultValue={result.currency_code ?? "USD"} maxLength={3} aria-label="Currency code" className={`${editorClass} -ml-2 mt-1 uppercase`} /> : null}</Metric>
            <Metric label="Direction"><select name="comparator" defaultValue={result.comparator} aria-label="Metric direction" className={`${editorClass} -ml-2`}><option value="at_least">Higher is better</option><option value="at_most">Lower is better</option></select></Metric>
        </div>
        <div className="flex min-h-11 items-center justify-between gap-3 border-t border-neutral-900 px-4 py-2 sm:px-5"><p className="text-xs text-neutral-600">Work items can be added after commitment.</p><div className="flex gap-1">{dirty ? <button disabled={pending} className="h-8 rounded-md bg-white px-3 text-xs font-medium text-black disabled:opacity-50">{pending ? "Saving…" : "Save Key Result"}</button> : null}<button type="button" disabled={pending} onClick={() => runWithoutForm(() => deleteOkrKeyResult(workspaceSlug, okr.id, result.id))} className="h-8 px-2 text-xs text-red-300/70 hover:text-red-200">Delete</button></div></div>
    </form>
}

function WorkItems({ workspaceSlug, okr, result, people, pending, onAdd, onUnlink }: { workspaceSlug: string; okr: WorkspaceOkr; result: OkrKeyResult; people: Record<string, string>; pending: boolean; onAdd: () => void; onUnlink: (workItemId: string) => void }) {
    return <section className="border-t border-neutral-900">
        <div className="flex items-center justify-between gap-3 px-4 py-2.5 sm:px-5"><p className="text-xs font-medium uppercase tracking-wide text-neutral-600">Work items</p>{okr.status === "active" ? <button type="button" onClick={onAdd} className="h-8 rounded-md border border-neutral-800 px-2.5 text-xs text-neutral-300 hover:border-neutral-600 hover:text-white">Add work item</button> : null}</div>
        {result.actions.length ? <div className="divide-y divide-neutral-900 border-t border-neutral-900">{result.actions.map((action) => {
            const assignees = action.assignee_ids.map((id) => people[id] ?? "Team member")
            return <div key={action.id} className="grid min-h-11 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-2 gap-y-1 px-4 py-2 text-sm sm:px-5 md:grid-cols-[auto_minmax(12rem,1fr)_auto_auto_auto]">
                <RoundPill tone={priorityTone(action.priority)}>{workItemPriorityLabel(action.priority)}</RoundPill>
                <Link href={`/${workspaceSlug}/work-items/${action.id}`} className="min-w-0 truncate font-medium text-neutral-200 hover:text-white">{action.title}</Link>
                <SquarePill tone={workStatusTone(action.status)} className="capitalize">{action.status.replace(/_/g, " ")}</SquarePill>
                <span className="col-start-2 truncate text-xs text-neutral-600 md:col-start-auto">{assignees.length ? assignees.join(", ") : "Unassigned"}</span>
                <div className="col-start-3 flex items-center justify-end gap-3 md:col-start-auto"><span className="whitespace-nowrap text-xs text-neutral-600">{displayDate(action.due_date)}</span><button type="button" disabled={pending} onClick={() => onUnlink(action.id)} aria-label={`Unlink ${action.title}`} className="text-neutral-700 hover:text-white">×</button></div>
            </div>
        })}</div> : <p className="border-t border-neutral-900 px-4 py-3 text-sm text-neutral-600 sm:px-5">No work items linked to this Key Result.</p>}
    </section>
}

export function OkrWorkspace({ workspaceSlug, okrs, ownerOptions, workItems, people }: Props) {
    const router = useRouter()
    const [dialog, setDialog] = useState<DialogState | null>(null)
    const [error, setError] = useState<string | null>(null)
    const [completionId, setCompletionId] = useState<string | null>(null)
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

    return <div className="mt-6 space-y-7">
        {error ? <div role="alert" className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-200">{error}</div> : null}
        {okrs.length ? okrs.map((okr) => {
            const draft = okr.status === "draft"
            return <section id={`okr-${okr.id}`} key={okr.id} className="scroll-mt-28 overflow-hidden rounded-2xl border border-neutral-800 bg-black shadow-sm shadow-black/20">
                <header className="flex flex-col gap-4 px-4 py-4 sm:px-5 lg:flex-row lg:items-start">
                    <div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><span className="font-mono text-xs text-neutral-600">OKR-{shortId(okr.id)}</span><Status label={okr.status} tone={statusTone(okr.status)} /></div><h2 className="mt-2 text-xl font-semibold leading-7 tracking-tight text-neutral-100">{okrDisplayTitle({ objectiveType: okr.objective_type, objective: okr.objective, deadline: okr.period_end })}</h2><p className="mt-2 text-xs text-neutral-600">{people[okr.owner_user_id] ?? "Admin"} · {okr.key_results.length} Key Result{okr.key_results.length === 1 ? "" : "s"} · Deadline {formatOkrDeadline(okr.period_end)}</p></div>
                    <div className="flex shrink-0 items-center justify-between gap-3 lg:justify-end"><ProgressRing progress={okr.attainment} />{draft ? <div className="flex flex-col gap-1.5"><button type="button" disabled={pending} onClick={() => runWithoutForm(() => commitOkr(workspaceSlug, okr.id))} className="h-9 rounded-lg bg-white px-3 text-sm font-medium text-black disabled:opacity-50">Commit OKR</button><button type="button" disabled={pending} onClick={() => runWithoutForm(() => deleteOkr(workspaceSlug, okr.id))} className="h-7 text-xs text-red-300/60 hover:text-red-200">Delete draft</button></div> : okr.status === "active" ? <button type="button" onClick={() => setCompletionId((current) => current === okr.id ? null : okr.id)} className="h-9 rounded-lg border border-neutral-800 px-3 text-sm text-neutral-300 hover:border-neutral-600 hover:text-white">Complete</button> : null}</div>
                </header>

                <OkrDefinition key={okr.updated_at} okr={okr} ownerOptions={ownerOptions} pending={pending} onSubmit={(event) => run(event, updateOkr.bind(null, workspaceSlug, okr.id))} />

                {completionId === okr.id ? <form onSubmit={(event) => run(event, (formData) => setOkrStatus(workspaceSlug, okr.id, "completed", formData))} className="flex flex-col gap-2 border-t border-neutral-900 bg-neutral-950/50 px-4 py-3 sm:flex-row sm:px-5"><textarea name="outcome_note" required rows={2} autoFocus placeholder="Record the outcome and final assessment…" className={`${modalTextareaClass} mt-0 flex-1`} /><button disabled={pending} className="h-10 self-end rounded-lg bg-white px-3 text-sm font-medium text-black disabled:opacity-50">Confirm completion</button></form> : null}
                {okr.outcome_note ? <p className="border-t border-neutral-900 px-4 py-3 text-sm leading-6 text-neutral-400 sm:px-5"><span className="mr-2 text-xs uppercase tracking-wide text-neutral-600">Outcome</span>{okr.outcome_note}</p> : null}

                <div className="flex items-center justify-between gap-4 border-t border-neutral-800 bg-neutral-950/30 px-4 py-3 sm:px-5"><div><h3 className="text-sm font-semibold">Key Results</h3><p className="mt-0.5 text-xs text-neutral-600">Measurements and the work responsible for moving them.</p></div>{draft ? <button type="button" onClick={() => setDialog({ type: "add-result", okr })} className="h-9 shrink-0 rounded-lg border border-neutral-700 px-3 text-sm text-neutral-200 hover:border-neutral-500">Add Key Result</button> : null}</div>

                <div className="divide-y divide-neutral-800">{okr.key_results.length ? okr.key_results.map((result) => {
                    if (draft) return <DraftKeyResult key={`${result.id}-${result.name}-${result.description}-${result.baseline_value}-${result.target_value}-${result.unit}-${result.comparator}`} workspaceSlug={workspaceSlug} okr={okr} result={result} pending={pending} run={run} runWithoutForm={runWithoutForm} />
                    const currency = result.currency_code ?? "USD"
                    const latest = result.measurements.at(-1)
                    const gap = okrGap(result.comparator, result.current_value, result.target_value)
                    return <article id={`key-result-${result.id}`} key={result.id} className="scroll-mt-28">
                        <div className="grid gap-4 px-4 py-4 sm:px-5 lg:grid-cols-[minmax(0,1fr)_auto]">
                            <div className="min-w-0"><p className="font-mono text-xs text-neutral-600">KR-{shortId(result.id)}</p><h4 className="mt-1 text-base font-semibold text-neutral-100">{result.name}</h4>{result.description ? <p className="mt-1 max-w-4xl text-sm leading-5 text-neutral-500">{result.description}</p> : null}{latest ? <p className="mt-2 text-xs text-neutral-600">Updated {formatRelativeTime(latest.measured_at)}{latest.note ? ` · ${latest.note}` : ""}</p> : <p className="mt-2 text-xs text-neutral-600">No measurements yet; current value is the base.</p>}</div>
                            <div className="flex items-center gap-3"><ProgressRing progress={result.progress} size="sm" />{okr.status === "active" ? <button type="button" onClick={() => setDialog({ type: "measurement", okr, result })} className="h-9 rounded-lg border border-neutral-800 px-3 text-sm text-neutral-300 hover:border-neutral-600 hover:text-white">Record progress</button> : null}</div>
                        </div>
                        <div className="grid border-t border-neutral-900 sm:grid-cols-4"><Metric label="Base">{formatOkrMetricValue(result.baseline_value, result.unit, currency)}</Metric><Metric label="Current">{formatOkrMetricValue(result.current_value, result.unit, currency)}</Metric><Metric label="Target">{formatOkrMetricValue(result.target_value, result.unit, currency)}</Metric><Metric label={result.target_met ? "Result" : "Remaining"}>{result.target_met ? "Target reached" : formatOkrMetricValue(gap, result.unit, currency)}</Metric></div>
                        <WorkItems workspaceSlug={workspaceSlug} okr={okr} result={result} people={people} pending={pending} onAdd={() => setDialog({ type: "add-work", okr, result })} onUnlink={(workItemId) => runWithoutForm(() => unlinkOkrAction(workspaceSlug, okr.id, result.id, workItemId))} />
                    </article>
                }) : <div className="px-4 py-8 text-center sm:px-5"><p className="text-sm font-medium text-neutral-300">No Key Results</p><p className="mt-1 text-sm text-neutral-600">Add the first measurable result before committing this Objective.</p>{draft ? <button type="button" onClick={() => setDialog({ type: "add-result", okr })} className="mt-3 h-9 rounded-lg border border-neutral-800 px-3 text-sm text-neutral-300">Add Key Result</button> : null}</div>}</div>
            </section>
        }) : <section className="rounded-2xl border border-dashed border-neutral-800 bg-black px-5 py-10 text-center"><p className="font-medium text-neutral-200">No committed Objectives or drafts yet.</p><p className="mt-1 text-sm text-neutral-500">Use Add OKR from the workspace actions to create the first draft.</p></section>}

        {dialog?.type === "add-result" ? <Modal title="Add Key Result" description="Define the result’s starting point and measurable target." onClose={() => setDialog(null)}><form onSubmit={(event) => run(event, addOkrKeyResult.bind(null, workspaceSlug, dialog.okr.id), true)} className="p-5"><NewKeyResultFields /><div className="mt-5 flex justify-end"><button disabled={pending} className="h-10 rounded-lg bg-white px-4 text-sm font-medium text-black disabled:opacity-50">{pending ? "Adding…" : "Add Key Result"}</button></div></form></Modal> : null}
        {dialog?.type === "measurement" ? <Modal title={`Record progress for KR-${shortId(dialog.result.id)}`} description={`${dialog.result.name} · current ${formatOkrMetricValue(dialog.result.current_value, dialog.result.unit, dialog.result.currency_code ?? "USD")}`} onClose={() => setDialog(null)}><form onSubmit={(event) => run(event, addOkrMeasurement.bind(null, workspaceSlug, dialog.okr.id, dialog.result.id), true)} className="grid gap-3 p-5 sm:grid-cols-2"><label className="text-sm text-neutral-300">Current value<input name="value" type="number" step="any" required autoFocus defaultValue={dialog.result.current_value} className={modalInputClass} /></label><label className="text-sm text-neutral-300">Measured at<input name="measured_at" type="datetime-local" className={modalInputClass} /></label><label className="text-sm text-neutral-300 sm:col-span-2">Note <span className="text-neutral-600">(optional)</span><textarea name="note" rows={2} className={modalTextareaClass} /></label><div className="flex justify-end sm:col-span-2"><button disabled={pending} className="h-10 rounded-lg bg-white px-4 text-sm font-medium text-black disabled:opacity-50">{pending ? "Recording…" : "Record progress"}</button></div></form></Modal> : null}
        {dialog?.type === "add-work" ? (() => {
            const linkedIds = new Set(dialog.result.actions.map((action) => action.id))
            const available = workItems.filter((item) => !linkedIds.has(item.id))
            return <Modal title={`Add work to KR-${shortId(dialog.result.id)}`} description="Create a private Admin work item or link existing work from this workspace." onClose={() => setDialog(null)}><div className="grid gap-5 p-5 md:grid-cols-2"><form onSubmit={(event) => run(event, createOkrAction.bind(null, workspaceSlug, dialog.okr.id, dialog.result.id), true)}><h3 className="font-medium">Create work item</h3><label className="mt-3 block text-sm text-neutral-300">Title<input name="title" required autoFocus placeholder="What needs to happen?" className={modalInputClass} /></label><label className="mt-3 block text-sm text-neutral-300">Description <span className="text-neutral-600">(optional)</span><textarea name="description" rows={3} className={modalTextareaClass} /></label><button disabled={pending} className="mt-4 h-10 w-full rounded-lg bg-white px-3 text-sm font-medium text-black disabled:opacity-50">Create and link</button></form><form onSubmit={(event) => run(event, linkOkrAction.bind(null, workspaceSlug, dialog.okr.id, dialog.result.id), true)} className="border-t border-neutral-800 pt-5 md:border-l md:border-t-0 md:pl-5 md:pt-0"><h3 className="font-medium">Link existing work</h3>{available.length ? <><label className="mt-3 block text-sm text-neutral-300">Work item<select name="work_item_id" className={modalInputClass}>{available.map((item) => <option key={item.id} value={item.id}>{item.title} · {workItemPriorityLabel(item.priority)}</option>)}</select></label><button disabled={pending} className="mt-4 h-10 w-full rounded-lg border border-neutral-700 px-3 text-sm text-neutral-200 disabled:opacity-50">Link work item</button></> : <p className="mt-3 text-sm leading-6 text-neutral-600">Every available work item is already linked to this Key Result.</p>}</form></div></Modal>
        })() : null}
    </div>
}
