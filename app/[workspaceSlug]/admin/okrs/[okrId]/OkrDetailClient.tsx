"use client"

import Link from "next/link"
import { useState, useTransition, type FormEvent, type ReactNode } from "react"
import { useRouter } from "next/navigation"
import { SquarePill, Status } from "@/components/ui"
import { formatOkrMetricValue, okrGap } from "@/lib/admin/okr-metrics"
import type { OkrKeyResult, WorkspaceOkr } from "@/lib/admin/okrs"
import { formatRelativeTime, shortId } from "@/lib/ui/relative-time"
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
} from "../../actions"

type Person = { user_id: string; role: string; name: string }
type PrivateItem = { id: string; title: string; status: string }

type Props = {
    workspaceSlug: string
    okr: WorkspaceOkr
    people: Person[]
    privateItems: PrivateItem[]
    recorderNames: Record<string, string>
}

const inputClass = "mt-1.5 h-10 w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 text-sm text-white outline-none focus:border-neutral-500 disabled:cursor-default disabled:border-transparent disabled:bg-transparent disabled:px-0 disabled:text-neutral-200"
const textareaClass = "mt-1.5 w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm leading-6 text-white outline-none focus:border-neutral-500 disabled:cursor-default disabled:resize-none disabled:border-transparent disabled:bg-transparent disabled:px-0 disabled:text-neutral-300"

function statusTone(status: string): "grey" | "yellow" | "green" | "red" {
    if (status === "completed") return "green"
    if (status === "active") return "yellow"
    if (status === "cancelled") return "red"
    return "grey"
}

function Field({ label, children }: { label: string; children: ReactNode }) {
    return <div className="grid min-h-12 grid-cols-[7.5rem_minmax(0,1fr)] items-start gap-3 border-b border-neutral-900 py-2.5 sm:grid-cols-[9rem_minmax(0,1fr)]"><p className="pt-2 text-sm text-neutral-500">{label}</p><div className="min-w-0">{children}</div></div>
}

function Modal({ title, description, onClose, children }: { title: string; description?: string; onClose: () => void; children: ReactNode }) {
    return <div role="dialog" aria-modal="true" aria-label={title} className="fixed inset-0 z-[100] flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
        <div className="max-h-[calc(100vh-2rem)] w-full max-w-2xl overflow-y-auto rounded-2xl border border-neutral-700 bg-neutral-950 shadow-2xl shadow-black/70">
            <div className="flex items-start gap-4 border-b border-neutral-800 px-5 py-4"><div className="min-w-0 flex-1"><h2 className="text-lg font-semibold text-white">{title}</h2>{description ? <p className="mt-1 text-sm leading-5 text-neutral-500">{description}</p> : null}</div><button type="button" onClick={onClose} aria-label="Close" className="rounded-md px-2 py-1 text-xl text-neutral-500 hover:bg-neutral-900 hover:text-white">×</button></div>
            {children}
        </div>
    </div>
}

function ProgressRing({ progress }: { progress: number }) {
    const bounded = Math.max(0, Math.min(100, progress))
    const circumference = 2 * Math.PI * 25
    return <div className="relative h-20 w-20 shrink-0" aria-label={`${Math.round(bounded)} percent attained`}>
        <svg viewBox="0 0 64 64" className="h-full w-full -rotate-90" aria-hidden="true"><circle cx="32" cy="32" r="25" fill="none" stroke="rgb(38 38 38)" strokeWidth="5" /><circle cx="32" cy="32" r="25" fill="none" stroke="white" strokeWidth="5" strokeLinecap="round" strokeDasharray={circumference} strokeDashoffset={circumference * (1 - bounded / 100)} /></svg>
        <span className="absolute inset-0 flex items-center justify-center text-sm font-semibold tabular-nums text-white">{Math.round(bounded)}%</span>
    </div>
}

function KeyResultForm({ result }: { result?: OkrKeyResult }) {
    const currency = result?.currency_code ?? "USD"
    return <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-sm text-neutral-300 sm:col-span-2">Key Result<input name="name" required autoFocus defaultValue={result?.name} placeholder="Increase booked calls" className={inputClass} /></label>
        <label className="text-sm text-neutral-300 sm:col-span-2">Description <span className="text-neutral-600">(optional)</span><textarea name="description" rows={2} defaultValue={result?.description ?? ""} className={textareaClass} /></label>
        <label className="text-sm text-neutral-300">Unit<select name="unit" defaultValue={result?.unit ?? "number"} className={inputClass}><option value="number">Number</option><option value="percentage">Percentage</option><option value="currency">Currency</option><option value="duration">Duration (hours)</option></select></label>
        <label className="text-sm text-neutral-300">Direction<select name="comparator" defaultValue={result?.comparator ?? "at_least"} className={inputClass}><option value="at_least">Higher is better</option><option value="at_most">Lower is better</option></select></label>
        <label className="text-sm text-neutral-300">Base<input name="baseline_value" type="number" step="any" required defaultValue={result?.baseline_value} placeholder="100" className={inputClass} /></label>
        <label className="text-sm text-neutral-300">Target<input name="target_value" type="number" step="any" required defaultValue={result?.target_value} placeholder="300" className={inputClass} /></label>
        <label className="text-sm text-neutral-300 sm:col-span-2">Currency code <span className="text-neutral-600">(used only for currency)</span><input name="currency_code" defaultValue={currency} maxLength={3} className={`${inputClass} uppercase`} /></label>
    </div>
}

export function OkrDetailClient({ workspaceSlug, okr, people, privateItems, recorderNames }: Props) {
    const router = useRouter()
    const [dialog, setDialog] = useState<{ type: "add-result" } | { type: "edit-result"; result: OkrKeyResult } | { type: "add-work"; result: OkrKeyResult } | null>(null)
    const [error, setError] = useState<string | null>(null)
    const [pending, startTransition] = useTransition()
    const draft = okr.status === "draft"
    const committed = okr.status === "active" && okr.objective_type === "committed"
    const linkedIds = new Set(okr.key_results.flatMap((result) => result.actions.map((action) => action.id)))

    function run(event: FormEvent<HTMLFormElement>, action: (formData: FormData) => Promise<void>, close = true) {
        event.preventDefault()
        const formData = new FormData(event.currentTarget)
        setError(null)
        startTransition(async () => {
            try {
                await action(formData)
                if (close) setDialog(null)
                router.refresh()
            } catch (cause) {
                setError(cause instanceof Error ? cause.message : "This change could not be saved")
            }
        })
    }

    function runWithoutForm(action: () => Promise<void>) {
        setError(null)
        startTransition(async () => {
            try { await action(); router.refresh() }
            catch (cause) { setError(cause instanceof Error ? cause.message : "This change could not be saved") }
        })
    }

    return <>
        {error ? <div role="alert" className="mt-4 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-200">{error}</div> : null}

        <section className="mt-6 overflow-hidden rounded-2xl border border-neutral-800 bg-black">
            <div className="flex flex-col gap-3 border-b border-neutral-900 px-5 py-4 sm:flex-row sm:items-center sm:justify-between"><div><h2 className="text-lg font-semibold">Objective details</h2><p className="mt-1 text-sm text-neutral-500">{draft ? "Shape the objective and its measures before making the commitment." : "The committed definition is locked; progress remains updateable through measurements and work."}</p></div>{draft ? <button type="button" disabled={pending} onClick={() => runWithoutForm(() => commitOkr(workspaceSlug, okr.id))} className="h-10 shrink-0 rounded-lg bg-white px-4 text-sm font-medium text-black disabled:opacity-50">{pending ? "Committing…" : "Commit OKR"}</button> : <SquarePill tone="sky">Committed</SquarePill>}</div>
            <form onSubmit={(event) => run(event, updateOkr.bind(null, workspaceSlug, okr.id), false)} className="px-5 pb-4">
                <Field label="Status"><div className="pt-1.5"><Status label={okr.status} tone={statusTone(okr.status)} /></div></Field>
                <Field label="Objective"><textarea name="objective" rows={2} required defaultValue={okr.objective} disabled={!draft} className={textareaClass} /></Field>
                <Field label="Owner"><select name="owner_user_id" defaultValue={okr.owner_user_id} disabled={!draft} className={inputClass}>{people.map((person) => <option key={person.user_id} value={person.user_id}>{person.name} · {person.role}</option>)}</select></Field>
                <Field label="Schedule"><div className="grid items-center gap-2 sm:grid-cols-[1fr_auto_1fr]"><label className="text-xs text-neutral-500">Starts<input name="period_start" type="date" required defaultValue={okr.period_start} disabled={!draft} className={inputClass} /></label><span className="mt-5 hidden text-neutral-600 sm:block">→</span><label className="text-xs text-neutral-500">Deadline<input name="period_end" type="date" required defaultValue={okr.period_end} disabled={!draft} className={inputClass} /></label></div></Field>
                <Field label="Description"><textarea name="description" rows={3} defaultValue={okr.description ?? ""} disabled={!draft} placeholder={draft ? "Add context for the team…" : "No description"} className={textareaClass} /></Field>
                {draft ? <div className="flex justify-end pt-3"><button disabled={pending} className="h-9 rounded-lg border border-neutral-700 px-3 text-sm text-neutral-200 hover:border-neutral-500 disabled:opacity-50">{pending ? "Saving…" : "Save changes"}</button></div> : null}
            </form>
        </section>

        <section className="mt-6">
            <div className="flex items-start justify-between gap-4"><div><h2 className="text-xl font-semibold">Key Results</h2><p className="mt-1 text-sm text-neutral-500">The measurable outcomes that determine whether the Objective was achieved.</p></div>{draft ? <button type="button" onClick={() => setDialog({ type: "add-result" })} className="h-10 shrink-0 rounded-lg bg-white px-4 text-sm font-medium text-black">Add Key Result</button> : null}</div>
            <div className="mt-4 space-y-4">
                {okr.key_results.length ? okr.key_results.map((result) => {
                    const currency = result.currency_code ?? "USD"
                    const gap = okrGap(result.comparator, result.current_value, result.target_value)
                    return <article id={`key-result-${result.id}`} key={result.id} className="scroll-mt-6 overflow-hidden rounded-2xl border border-neutral-800 bg-black">
                        <div className="flex flex-col gap-5 p-5 sm:flex-row sm:items-start">
                            <div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><p className="font-mono text-xs text-neutral-600">KR-{shortId(result.id)}</p>{draft ? <SquarePill tone="neutral">Draft</SquarePill> : null}</div><h3 className="mt-2 text-lg font-semibold">{result.name}</h3>{result.description ? <p className="mt-2 max-w-3xl text-sm leading-6 text-neutral-500">{result.description}</p> : null}<div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm"><span><span className="text-neutral-600">Base</span> {formatOkrMetricValue(result.baseline_value, result.unit, currency)}</span><span className="text-neutral-700">→</span><span><span className="text-neutral-600">Target</span> {formatOkrMetricValue(result.target_value, result.unit, currency)}</span>{committed ? <span><span className="text-neutral-600">Current</span> {formatOkrMetricValue(result.current_value, result.unit, currency)}</span> : null}</div></div>
                            {draft ? <div className="flex shrink-0 gap-2"><button type="button" onClick={() => setDialog({ type: "edit-result", result })} className="h-9 rounded-lg border border-neutral-700 px-3 text-sm text-neutral-200">Edit</button><button type="button" disabled={pending} onClick={() => runWithoutForm(() => deleteOkrKeyResult(workspaceSlug, okr.id, result.id))} className="h-9 rounded-lg px-3 text-sm text-red-300">Delete</button></div> : <ProgressRing progress={result.progress} />}
                        </div>
                        {committed ? <div className="grid gap-0 border-t border-neutral-900 lg:grid-cols-2 lg:divide-x lg:divide-neutral-900">
                            <section className="p-5"><div className="flex items-center justify-between gap-3"><h4 className="font-medium">Progress</h4><p className="text-xs text-neutral-500">{result.target_met ? "Target reached" : `${formatOkrMetricValue(gap, result.unit, currency)} remaining`}</p></div><form onSubmit={(event) => run(event, addOkrMeasurement.bind(null, workspaceSlug, okr.id, result.id), false)} className="mt-3 grid gap-2 sm:grid-cols-[1fr_1fr_auto]"><input name="value" type="number" step="any" required placeholder="Current value" className={inputClass} /><input name="measured_at" type="datetime-local" aria-label="Measured at" className={inputClass} /><button disabled={pending} className="mt-1.5 h-10 rounded-lg bg-white px-3 text-sm font-medium text-black disabled:opacity-50">Record</button><input name="note" placeholder="Optional note" className={`${inputClass} sm:col-span-3`} /></form><div className="mt-3 max-h-40 divide-y divide-neutral-900 overflow-y-auto">{result.measurements.length ? [...result.measurements].reverse().map((measurement) => <div key={measurement.id} className="flex items-start justify-between gap-3 py-2 text-sm"><div><p>{formatOkrMetricValue(measurement.value, result.unit, currency)}</p>{measurement.note ? <p className="mt-0.5 text-xs text-neutral-500">{measurement.note}</p> : null}<p className="mt-0.5 text-[11px] text-neutral-700">{measurement.recorded_by ? recorderNames[measurement.recorded_by] ?? "Admin" : "System"}</p></div><p className="shrink-0 text-xs text-neutral-600">{formatRelativeTime(measurement.measured_at)}</p></div>) : <p className="py-3 text-sm text-neutral-600">No measurements yet. Current is the base value.</p>}</div></section>
                            <section className="p-5"><div className="flex items-center justify-between gap-3"><div><h4 className="font-medium">Work items</h4><p className="mt-1 text-xs text-neutral-600">Work linked directly to this Key Result.</p></div><button type="button" onClick={() => setDialog({ type: "add-work", result })} className="h-9 shrink-0 rounded-lg border border-neutral-700 px-3 text-sm text-neutral-200">Add work item</button></div><div className="mt-3 divide-y divide-neutral-900 rounded-xl border border-neutral-900">{result.actions.length ? result.actions.map((action) => <div key={action.id} className="flex items-center gap-3 px-3 py-2.5"><Link href={`/${workspaceSlug}/work-items/${action.id}`} className="min-w-0 flex-1"><p className="truncate text-sm text-neutral-200">{action.title}</p><p className="mt-0.5 text-xs capitalize text-neutral-600">{action.status} · {shortId(action.id)}</p></Link><button type="button" disabled={pending} onClick={() => runWithoutForm(() => unlinkOkrAction(workspaceSlug, okr.id, result.id, action.id))} aria-label={`Unlink ${action.title}`} className="text-neutral-600 hover:text-white">×</button></div>) : <p className="px-3 py-4 text-sm text-neutral-600">No work items linked.</p>}</div></section>
                        </div> : null}
                    </article>
                }) : <div className="rounded-2xl border border-dashed border-neutral-800 bg-neutral-900/30 px-5 py-8 text-center"><p className="font-medium text-neutral-200">No Key Results</p><p className="mt-1 text-sm text-neutral-500">Add the first measurable result before committing this Objective.</p>{draft ? <button type="button" onClick={() => setDialog({ type: "add-result" })} className="mt-4 h-9 rounded-lg border border-neutral-700 px-3 text-sm text-neutral-200">Add Key Result</button> : null}</div>}
            </div>
        </section>

        {okr.status === "active" ? <section className="mt-6 rounded-2xl border border-neutral-800 bg-black p-5"><h2 className="text-lg font-semibold">Complete this OKR</h2><p className="mt-1 text-sm text-neutral-500">At the deadline, record the team’s assessment and close the committed cycle.</p><form onSubmit={(event) => run(event, (formData) => setOkrStatus(workspaceSlug, okr.id, "completed", formData), false)} className="mt-4 flex flex-col gap-2 sm:flex-row"><textarea name="outcome_note" required rows={2} placeholder="Outcome and final assessment" className={`${textareaClass} flex-1`} /><button disabled={pending} className="h-10 self-end rounded-lg border border-neutral-700 px-4 text-sm text-neutral-200 disabled:opacity-50">Complete OKR</button></form></section> : null}

        {draft ? <section className="mt-6 border-t border-neutral-900 pt-5"><form action={deleteOkr.bind(null, workspaceSlug, okr.id)}><button className="text-sm text-red-300/70 hover:text-red-200">Delete draft</button></form></section> : null}

        {dialog?.type === "add-result" ? <Modal title="Add Key Result" description="Define the result’s starting point and measurable target." onClose={() => setDialog(null)}><form onSubmit={(event) => run(event, addOkrKeyResult.bind(null, workspaceSlug, okr.id))} className="p-5"><KeyResultForm /><div className="mt-5 flex justify-end gap-2"><button type="button" onClick={() => setDialog(null)} className="h-10 px-3 text-sm text-neutral-400">Cancel</button><button disabled={pending} className="h-10 rounded-lg bg-white px-4 text-sm font-medium text-black disabled:opacity-50">{pending ? "Adding…" : "Add Key Result"}</button></div></form></Modal> : null}
        {dialog?.type === "edit-result" ? <Modal title="Edit Key Result" description="Key Result definitions are editable while the OKR remains a draft." onClose={() => setDialog(null)}><form onSubmit={(event) => run(event, updateOkrKeyResult.bind(null, workspaceSlug, okr.id, dialog.result.id))} className="p-5"><KeyResultForm result={dialog.result} /><div className="mt-5 flex justify-end gap-2"><button type="button" onClick={() => setDialog(null)} className="h-10 px-3 text-sm text-neutral-400">Cancel</button><button disabled={pending} className="h-10 rounded-lg bg-white px-4 text-sm font-medium text-black disabled:opacity-50">{pending ? "Saving…" : "Save Key Result"}</button></div></form></Modal> : null}
        {dialog?.type === "add-work" ? <Modal title={`Add work to KR-${shortId(dialog.result.id)}`} description="Create a private Admin work item or link one that already exists." onClose={() => setDialog(null)}><div className="grid gap-5 p-5 md:grid-cols-2"><form onSubmit={(event) => run(event, createOkrAction.bind(null, workspaceSlug, okr.id, dialog.result.id))}><h3 className="font-medium">Create work item</h3><label className="mt-3 block text-sm text-neutral-300">Title<input name="title" required autoFocus placeholder="What needs to happen?" className={inputClass} /></label><label className="mt-3 block text-sm text-neutral-300">Description <span className="text-neutral-600">(optional)</span><textarea name="description" rows={3} className={textareaClass} /></label><button disabled={pending} className="mt-4 h-10 w-full rounded-lg bg-white px-3 text-sm font-medium text-black disabled:opacity-50">Create and link</button></form><form onSubmit={(event) => run(event, linkOkrAction.bind(null, workspaceSlug, okr.id, dialog.result.id))} className="border-t border-neutral-800 pt-5 md:border-l md:border-t-0 md:pl-5 md:pt-0"><h3 className="font-medium">Link existing Admin work</h3><label className="mt-3 block text-sm text-neutral-300">Work item<select name="work_item_id" className={inputClass}>{privateItems.filter((item) => !linkedIds.has(item.id)).map((item) => <option key={item.id} value={item.id}>{item.title} · {item.status}</option>)}</select></label>{privateItems.some((item) => !linkedIds.has(item.id)) ? <button disabled={pending} className="mt-4 h-10 w-full rounded-lg border border-neutral-700 px-3 text-sm text-neutral-200 disabled:opacity-50">Link work item</button> : <p className="mt-4 text-sm text-neutral-600">No unlinked Admin work items are available.</p>}</form></div></Modal> : null}
    </>
}
