import Link from "next/link"
import { notFound } from "next/navigation"
import type { ReactNode } from "react"
import { SquarePill, Status } from "@/components/ui"
import { WorkspaceTopBar } from "@/components/workspace/WorkspaceTopBar"
import { formatOkrMetricValue, okrGap } from "@/lib/admin/okr-metrics"
import { getWorkspaceOkr } from "@/lib/admin/okrs"
import { formatOkrDeadline, okrDisplayTitle, okrTypeLabel } from "@/lib/admin/okr-title"
import { supabaseAdmin } from "@/lib/supabase/admin"
import { formatRelativeTime, shortId } from "@/lib/ui/relative-time"
import { requireWorkspace } from "@/lib/workspaces"
import { addOkrKeyResult, addOkrMeasurement, createOkrAction, deleteOkr, deleteOkrKeyResult, linkOkrAction, setOkrStatus, unlinkOkrAction, updateOkr, updateOkrKeyResult } from "../../actions"

export const dynamic = "force-dynamic"

type PageProps = { params: Promise<{ workspaceSlug: string; okrId: string }> }

function statusTone(status: string): "grey" | "yellow" | "green" | "red" {
    if (status === "completed") return "green"
    if (status === "active") return "yellow"
    if (status === "cancelled") return "red"
    return "grey"
}

function DetailField({ label, children }: { label: string; children: ReactNode }) {
    return <div className="grid min-h-11 grid-cols-[7.5rem_minmax(0,1fr)] items-start gap-3 border-b border-neutral-900 py-2.5 sm:grid-cols-[9rem_minmax(0,1fr)]"><p className="text-sm text-neutral-500">{label}</p><div className="min-w-0 text-sm text-neutral-200">{children}</div></div>
}

export default async function OkrDetailPage({ params }: PageProps) {
    const { workspaceSlug, okrId } = await params
    const { workspace, user } = await requireWorkspace(workspaceSlug, "admin")
    const okr = await getWorkspaceOkr(workspace.id, okrId)
    if (!okr) notFound()

    const [{ data: memberships }, { data: privateItems }] = await Promise.all([
        supabaseAdmin.from("workspace_memberships").select("user_id, role").eq("workspace_id", workspace.id).in("role", ["owner", "admin"]),
        supabaseAdmin.from("work_items").select("id, title, status").eq("workspace_id", workspace.id).eq("area", "admin").eq("visibility", "admins_only").order("updated_at", { ascending: false }).limit(100),
    ])
    const ids = (memberships ?? []).map((membership) => membership.user_id)
    const { data: profiles } = ids.length ? await supabaseAdmin.from("user_profiles").select("user_id, username").in("user_id", ids) : { data: [] }
    const names = new Map((profiles ?? []).map((profile) => [profile.user_id, profile.username]))
    const people = (memberships ?? []).map((membership) => ({ ...membership, name: names.get(membership.user_id) ?? membership.role }))
    const linkedIds = new Set(okr.key_results.flatMap((result) => result.actions.map((action) => action.id)))
    const targetCount = okr.key_results.filter((result) => result.target_met).length
    const displayTitle = okrDisplayTitle({ objectiveType: okr.objective_type, objective: okr.objective, deadline: okr.period_end })

    return <main className="min-h-screen bg-neutral-950 px-4 py-6 text-white sm:px-6">
        <WorkspaceTopBar userId={user.id} workspace={workspace} currentProduct="client-work" />
        <div className="mx-auto max-w-[92rem]">
            <header className="border-b border-neutral-800 pb-5">
                <p className="font-mono text-sm text-neutral-500">OKR {shortId(okr.id)}</p>
                <h1 className="mt-2 max-w-5xl text-3xl font-semibold tracking-tight">{displayTitle}</h1>
                {okr.description ? <p className="mt-3 max-w-3xl text-sm leading-6 text-neutral-400">{okr.description}</p> : null}
                <div className="mt-4 flex flex-wrap items-center gap-3">
                    <SquarePill tone={okr.objective_type === "aspirational" ? "violet" : "sky"}>{okrTypeLabel(okr.objective_type)}</SquarePill>
                    <Status label={okr.status.replace(/_/g, " ")} tone={statusTone(okr.status)} />
                    <span className="text-xs text-neutral-600">Updated {formatRelativeTime(okr.updated_at)}</span>
                </div>
            </header>

            <section className="mt-4 grid grid-cols-2 gap-2 sm:mt-6 md:grid-cols-4 md:gap-3">
                <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-4"><p className="text-sm text-neutral-500">Attainment</p><p className="mt-2 text-2xl font-semibold tabular-nums">{Math.round(okr.attainment)}%</p></div>
                <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-4"><p className="text-sm text-neutral-500">Key Results</p><p className="mt-2 font-medium">{okr.key_results.length}</p></div>
                <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-4"><p className="text-sm text-neutral-500">Targets met</p><p className="mt-2 font-medium">{targetCount} of {okr.key_results.length}</p></div>
                <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-4"><p className="text-sm text-neutral-500">Deadline</p><p className="mt-2 font-medium">{formatOkrDeadline(okr.period_end)}</p></div>
            </section>

            <section className="mt-6 rounded-xl border border-neutral-800 bg-black px-5 py-4">
                <div className="grid grid-cols-1 lg:grid-cols-2 lg:gap-x-8">
                    <div>
                        <DetailField label="Objective">{okr.objective}</DetailField>
                        <DetailField label="OKR type"><span>{okrTypeLabel(okr.objective_type)}</span><p className="mt-1 text-xs leading-5 text-neutral-600">{okr.objective_type === "aspirational" ? "A stretch outcome intended to push beyond the expected result." : "An outcome the owner is expected to deliver in full."}</p></DetailField>
                        <DetailField label="Owner">{people.find((person) => person.user_id === okr.owner_user_id)?.name ?? "Admin"}</DetailField>
                    </div>
                    <div>
                        <DetailField label="Starts">{formatOkrDeadline(okr.period_start)}</DetailField>
                        <DetailField label="Deadline">{formatOkrDeadline(okr.period_end)}</DetailField>
                        <DetailField label="Description">{okr.description ?? <span className="text-neutral-600">Not set</span>}</DetailField>
                    </div>
                </div>

                <details className="mt-4 border-t border-neutral-900 pt-4">
                    <summary className="cursor-pointer text-sm text-neutral-400 hover:text-white">Edit OKR details</summary>
                    <form action={updateOkr.bind(null, workspace.slug, okr.id)} className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                        <label className="text-sm text-neutral-300 sm:col-span-2 lg:col-span-4">Objective<input name="objective" defaultValue={okr.objective} required className="mt-1.5 h-10 w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 text-white" /></label>
                        <label className="text-sm text-neutral-300 sm:col-span-2 lg:col-span-4">Description<textarea name="description" defaultValue={okr.description ?? ""} rows={2} className="mt-1.5 w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-white" /></label>
                        <label className="text-sm text-neutral-300">OKR type<select name="objective_type" defaultValue={okr.objective_type} className="mt-1.5 h-10 w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 text-white"><option value="committed">Committed</option><option value="aspirational">Aspirational</option></select></label>
                        <label className="text-sm text-neutral-300">Owner<select name="owner_user_id" defaultValue={okr.owner_user_id} className="mt-1.5 h-10 w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 text-white">{people.map((person) => <option key={person.user_id} value={person.user_id}>{person.name} · {person.role}</option>)}</select></label>
                        <label className="text-sm text-neutral-300">Starts<input name="period_start" type="date" defaultValue={okr.period_start} required className="mt-1.5 h-10 w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 text-white" /></label>
                        <label className="text-sm text-neutral-300">Deadline<input name="period_end" type="date" defaultValue={okr.period_end} required className="mt-1.5 h-10 w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 text-white" /></label>
                        <div className="flex justify-end sm:col-span-2 lg:col-span-4"><button className="h-10 rounded-lg bg-white px-4 text-sm font-medium text-black">Save OKR details</button></div>
                    </form>
                </details>
            </section>

            <section className="mt-6 rounded-xl border border-neutral-800 bg-black px-5 py-4">
                <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
                    <div><h2 className="text-lg font-semibold">Lifecycle</h2><p className="mt-1 text-sm text-neutral-500">Status is a deliberate decision; attainment does not close an OKR automatically.</p></div>
                    <div className="w-full sm:w-72">
                        {okr.status === "draft" ? <form action={setOkrStatus.bind(null, workspace.slug, okr.id, "active")}><button className="w-full rounded-lg bg-white px-3 py-2 text-sm font-medium text-black">Activate OKR</button></form> : null}
                        {okr.status === "active" ? <form action={setOkrStatus.bind(null, workspace.slug, okr.id, "completed")} className="space-y-2"><textarea name="outcome_note" required rows={2} placeholder="Outcome and final assessment" className="w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-white" /><button className="w-full rounded-lg bg-white px-3 py-2 text-sm font-medium text-black">Confirm completion</button></form> : null}
                        {!(["completed", "cancelled"] as string[]).includes(okr.status) ? <form action={setOkrStatus.bind(null, workspace.slug, okr.id, "cancelled")} className="mt-2"><input type="hidden" name="outcome_note" value="Cancelled by an administrator." /><button className="w-full rounded-lg border border-red-900/60 px-3 py-2 text-sm text-red-200">Cancel OKR</button></form> : null}
                    </div>
                </div>
                {okr.outcome_note ? <div className="mt-4 border-t border-neutral-900 pt-4"><p className="text-xs text-neutral-600">Recorded outcome</p><p className="mt-2 text-sm leading-6 text-neutral-300">{okr.outcome_note}</p></div> : null}
            </section>

            <section className="mt-6">
                <div><h2 className="text-xl font-semibold">Key Results</h2><p className="mt-1 text-sm text-neutral-500">Each Key Result owns one metric, its target, measurement history, and accountable actions.</p></div>
                <div className="mt-4 space-y-5">{okr.key_results.length ? okr.key_results.map((result) => {
                    const currency = result.currency_code ?? "USD"
                    const gap = okrGap(result.comparator, result.current_value, result.target_value)
                    return <article id={`key-result-${result.id}`} key={result.id} className="scroll-mt-6 overflow-hidden rounded-xl border border-neutral-800 bg-black">
                        <div className="border-b border-neutral-900 p-5"><div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between"><div><p className="font-mono text-xs text-neutral-600">Key Result {shortId(result.id)}</p><h3 className="mt-2 text-lg font-semibold">{result.name}</h3>{result.description ? <p className="mt-2 text-sm leading-6 text-neutral-500">{result.description}</p> : null}<p className="mt-2 text-xs text-neutral-600">Target: {result.comparator === "at_most" ? "At most" : "At least"} {formatOkrMetricValue(result.target_value, result.unit, currency)}</p></div><div className="text-left sm:text-right"><p className={result.target_met ? "text-lime-200" : "text-white"}>{Math.round(result.progress)}% attained</p><p className="mt-1 text-xs text-neutral-500">{result.target_met ? "Target met" : `${formatOkrMetricValue(gap, result.unit, currency)} remaining`}</p></div></div><div className="mt-4 h-2 overflow-hidden rounded-full bg-neutral-900"><div className={`h-full ${result.target_met ? "bg-lime-300" : "bg-white"}`} style={{ width: `${result.progress}%` }} /></div></div>
                        <div className="grid divide-y divide-neutral-900 sm:grid-cols-3 sm:divide-x sm:divide-y-0"><div className="p-4"><p className="text-xs text-neutral-500">Baseline</p><p className="mt-1 text-lg font-medium">{formatOkrMetricValue(result.baseline_value, result.unit, currency)}</p></div><div className="p-4"><p className="text-xs text-neutral-500">Current</p><p className="mt-1 text-lg font-medium">{formatOkrMetricValue(result.current_value, result.unit, currency)}</p></div><div className="p-4"><p className="text-xs text-neutral-500">Target</p><p className="mt-1 text-lg font-medium">{formatOkrMetricValue(result.target_value, result.unit, currency)}</p></div></div>
                        <div className="grid gap-6 border-t border-neutral-900 p-5 lg:grid-cols-2">
                            <section><h4 className="font-medium">Metric measurements</h4><form action={addOkrMeasurement.bind(null, workspace.slug, okr.id, result.id)} className="mt-3 grid gap-2 sm:grid-cols-[1fr_1fr_auto]"><input name="value" type="number" step="any" required placeholder="Current value" className="h-10 rounded-lg border border-neutral-700 bg-neutral-950 px-3 text-sm text-white" /><input name="measured_at" type="datetime-local" className="h-10 rounded-lg border border-neutral-700 bg-neutral-950 px-3 text-sm text-white" /><button className="h-10 rounded-lg bg-white px-3 text-sm font-medium text-black">Record</button><input name="note" placeholder="Optional measurement note" className="h-10 rounded-lg border border-neutral-800 bg-neutral-950 px-3 text-sm text-white sm:col-span-3" /></form><div className="mt-3 max-h-40 divide-y divide-neutral-900 overflow-y-auto">{result.measurements.length ? [...result.measurements].reverse().map((measurement) => <div key={measurement.id} className="flex items-start justify-between gap-3 py-2 text-sm"><div><p className="text-neutral-200">{formatOkrMetricValue(measurement.value, result.unit, currency)}</p>{measurement.note ? <p className="mt-0.5 text-xs text-neutral-500">{measurement.note}</p> : null}<p className="mt-0.5 text-[11px] text-neutral-700">Manual · {measurement.recorded_by ? names.get(measurement.recorded_by) ?? "Admin" : "System record"}</p></div><p className="shrink-0 text-xs text-neutral-600">{formatRelativeTime(measurement.measured_at)}</p></div>) : <p className="py-3 text-sm text-neutral-600">No measurements; current value is the baseline.</p>}</div></section>
                            <section><h4 className="font-medium">Actions</h4><div className="mt-3 divide-y divide-neutral-900 rounded-xl border border-neutral-900">{result.actions.length ? result.actions.map((action) => <div key={action.id} className="flex items-center gap-3 px-3 py-2.5"><Link href={`/${workspace.slug}/work-items/${action.id}`} className="min-w-0 flex-1"><p className="truncate text-sm text-neutral-200">{action.title}</p><p className="text-xs capitalize text-neutral-600">{action.status} · {shortId(action.id)}</p></Link><form action={unlinkOkrAction.bind(null, workspace.slug, okr.id, result.id, action.id)}><button aria-label={`Unlink ${action.title}`} className="text-neutral-600 hover:text-white">×</button></form></div>) : <p className="px-3 py-4 text-sm text-neutral-600">No action work is linked.</p>}</div><form action={createOkrAction.bind(null, workspace.slug, okr.id, result.id)} className="mt-3 grid gap-2"><input name="title" required placeholder="Create a private action" className="h-10 rounded-lg border border-neutral-700 bg-neutral-950 px-3 text-sm text-white" /><input name="description" placeholder="Optional instructions" className="h-10 rounded-lg border border-neutral-800 bg-neutral-950 px-3 text-sm text-white" /><button className="h-10 rounded-lg border border-neutral-700 px-3 text-sm text-neutral-200">Create and assign to OKR owner</button></form>{(privateItems ?? []).some((item) => !linkedIds.has(item.id)) ? <form action={linkOkrAction.bind(null, workspace.slug, okr.id, result.id)} className="mt-2 flex gap-2"><select name="work_item_id" className="h-10 min-w-0 flex-1 rounded-lg border border-neutral-800 bg-neutral-950 px-3 text-sm text-white">{(privateItems ?? []).filter((item) => !linkedIds.has(item.id)).map((item) => <option key={item.id} value={item.id}>{item.title} · {item.status}</option>)}</select><button className="h-10 rounded-lg border border-neutral-800 px-3 text-sm text-neutral-300">Link</button></form> : null}</section>
                        </div>
                        <div className="border-t border-neutral-900 px-5 py-3"><details><summary className="cursor-pointer text-xs text-neutral-500">Edit metric definition</summary><form action={updateOkrKeyResult.bind(null, workspace.slug, okr.id, result.id)} className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4"><input name="name" defaultValue={result.name} required aria-label="Key Result name" className="h-9 rounded-lg border border-neutral-800 bg-neutral-950 px-3 text-sm text-white sm:col-span-2" /><input name="description" defaultValue={result.description ?? ""} aria-label="Key Result description" className="h-9 rounded-lg border border-neutral-800 bg-neutral-950 px-3 text-sm text-white sm:col-span-2" /><select name="unit" defaultValue={result.unit} aria-label="Metric unit" className="h-9 rounded-lg border border-neutral-800 bg-neutral-950 px-3 text-sm text-white"><option value="number">Number</option><option value="percentage">Percentage</option><option value="currency">Currency</option><option value="duration">Duration (hours)</option></select><input name="currency_code" defaultValue={currency} maxLength={3} aria-label="Currency code" className="h-9 rounded-lg border border-neutral-800 bg-neutral-950 px-3 text-sm uppercase text-white" /><select name="comparator" defaultValue={result.comparator} aria-label="Comparator" className="h-9 rounded-lg border border-neutral-800 bg-neutral-950 px-3 text-sm text-white"><option value="at_least">At least</option><option value="at_most">At most</option></select><span /><input name="baseline_value" type="number" step="any" defaultValue={result.baseline_value} required aria-label="Baseline value" className="h-9 rounded-lg border border-neutral-800 bg-neutral-950 px-3 text-sm text-white" /><input name="target_value" type="number" step="any" defaultValue={result.target_value} required aria-label="Target value" className="h-9 rounded-lg border border-neutral-800 bg-neutral-950 px-3 text-sm text-white" /><button className="h-9 rounded-lg border border-neutral-700 px-3 text-sm text-neutral-200">Save Key Result</button></form></details><form action={deleteOkrKeyResult.bind(null, workspace.slug, okr.id, result.id)} className="mt-3 text-right"><button className="text-xs text-red-300/70 hover:text-red-200">Delete Key Result</button></form></div>
                    </article>
                }) : <div className="rounded-xl border border-dashed border-neutral-800 bg-neutral-900/30 px-5 py-6"><p className="font-medium text-neutral-200">No Key Results yet.</p><p className="mt-1 text-sm text-neutral-500">Add the measurable outcomes that will determine whether this objective is attained.</p></div>}</div>
            </section>

            <section className="mt-6 rounded-xl border border-dashed border-neutral-800 bg-neutral-900/30 p-5"><h2 className="text-lg font-semibold">Add Key Result</h2><p className="mt-1 text-sm text-neutral-500">Define a measurable result directly—there is no separate KPI catalogue in v1.</p><form action={addOkrKeyResult.bind(null, workspace.slug, okr.id)} className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4"><label className="text-sm text-neutral-300 sm:col-span-2 lg:col-span-4">Result name<input name="name" required className="mt-1.5 h-10 w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 text-white" placeholder="Increase booked calls" /></label><label className="text-sm text-neutral-300 sm:col-span-2 lg:col-span-4">Description<input name="description" className="mt-1.5 h-10 w-full rounded-lg border border-neutral-800 bg-neutral-950 px-3 text-white" /></label><label className="text-sm text-neutral-300">Unit<select name="unit" className="mt-1.5 h-10 w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 text-white"><option value="number">Number</option><option value="percentage">Percentage</option><option value="currency">Currency</option><option value="duration">Duration (hours)</option></select></label><label className="text-sm text-neutral-300">Currency code<input name="currency_code" defaultValue="USD" maxLength={3} className="mt-1.5 h-10 w-full rounded-lg border border-neutral-800 bg-neutral-950 px-3 uppercase text-white" /></label><label className="text-sm text-neutral-300">Comparator<select name="comparator" className="mt-1.5 h-10 w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 text-white"><option value="at_least">At least</option><option value="at_most">At most</option></select></label><span /><label className="text-sm text-neutral-300">Baseline<input name="baseline_value" type="number" step="any" required className="mt-1.5 h-10 w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 text-white" /></label><label className="text-sm text-neutral-300">Target<input name="target_value" type="number" step="any" required className="mt-1.5 h-10 w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 text-white" /></label><div className="flex items-end sm:col-span-2"><button className="h-10 rounded-lg bg-white px-4 text-sm font-medium text-black">Add Key Result</button></div></form></section>

            <section className="mt-6 rounded-xl border border-red-500/20 bg-red-950/10 p-5"><h2 className="text-lg font-semibold text-red-100">Danger zone</h2><p className="mt-2 text-sm leading-6 text-red-100/70">Deleting this OKR permanently removes its Key Results and measurement history. Linked Admin work items remain available.</p><form action={deleteOkr.bind(null, workspace.slug, okr.id)} className="mt-4"><button className="rounded-lg border border-red-900/60 px-3 py-2 text-sm text-red-200">Delete OKR</button></form></section>
        </div>
    </main>
}
