"use client"

import { useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from "react"
import { ListActionMenu } from "@/components/list/ListActionMenu"
import {
    APPOINTMENT_FIELD_OPTIONS,
    APPOINTMENT_MEDIUM_OPTIONS,
    type AppointmentFieldKey,
    type AppointmentMedium,
    type AppointmentSettingAppointment,
    type AppointmentSettingConfiguration,
} from "@/lib/appointment-setting"
import { createSupabaseBrowserClient } from "@/lib/supabase/browser"
import { runWorkspaceMutation, type WorkspaceMutationResult } from "@/lib/workspace-mutations"
import {
    createAppointmentSettingAppointment,
    deleteAppointmentSettingAppointment,
    updateAppointmentSettingAppointment,
    type AppointmentUpdateField,
} from "@/app/[workspaceSlug]/appointment-setting/[relationshipId]/actions"

type Props = {
    workspaceId: string
    workspaceSlug: string
    relationshipId: string
    serviceId: string
    initialAppointments: AppointmentSettingAppointment[]
    configuration: AppointmentSettingConfiguration
}

const APPOINTMENT_SELECT = "id, workspace_id, relationship_id, service_id, contact_name, phone, appointment_at, appointment_timezone, meeting_medium, meeting_link, details, created_by, updated_by, created_at, updated_at"
const inputClass = "h-9 w-full rounded-md border border-neutral-700 bg-black px-2.5 text-sm text-white outline-none transition placeholder:text-neutral-700 focus:border-neutral-400 disabled:opacity-60"

function browserTimezone() {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"
}

function datePart(value: string) {
    const date = new Date(value)
    if (Number.isNaN(date.getTime())) return ""
    const pad = (part: number) => String(part).padStart(2, "0")
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

function timePart(value: string) {
    const date = new Date(value)
    if (Number.isNaN(date.getTime())) return ""
    return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`
}

function combineLocalDateTime(date: string, time: string) {
    const parsed = new Date(`${date}T${time}`)
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString()
}

function dateLabel(value: string, timeZone: string) {
    try {
        return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone }).format(new Date(value))
    } catch {
        return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(new Date(value))
    }
}

function timeLabel(value: string, timeZone: string) {
    try {
        return new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone, timeZoneName: "short" }).format(new Date(value))
    } catch {
        return new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone: "UTC", timeZoneName: "short" }).format(new Date(value))
    }
}

function sortAppointments(rows: AppointmentSettingAppointment[]) {
    return [...rows].sort((left, right) => left.appointment_at.localeCompare(right.appointment_at) || left.created_at.localeCompare(right.created_at))
}

function detailValue(row: AppointmentSettingAppointment, key: AppointmentFieldKey) {
    return key === "phone" ? row.phone ?? "" : String(row.details?.[key] ?? "")
}

function EditableCell({ label, value, displayValue, type = "text", pending, required = true, onSave }: {
    label: string
    value: string
    displayValue: string
    type?: "text" | "tel" | "email" | "url" | "date" | "time"
    pending: boolean
    required?: boolean
    onSave: (value: string) => Promise<boolean>
}) {
    const [editing, setEditing] = useState(false)
    const [draft, setDraft] = useState(value)
    const committing = useRef(false)

    async function commit() {
        if (committing.current) return
        const cleaned = draft.trim()
        if (cleaned === value || (!cleaned && required)) {
            setDraft(value)
            setEditing(false)
            return
        }
        committing.current = true
        const saved = await onSave(cleaned)
        committing.current = false
        if (saved) setEditing(false)
    }

    function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
        if (event.key === "Escape") { event.preventDefault(); setDraft(value); setEditing(false) }
        if (event.key === "Enter") { event.preventDefault(); void commit() }
    }

    if (editing) return <input type={type} aria-label={label} autoFocus required={required} disabled={pending} value={draft} onChange={(event) => setDraft(event.target.value)} onBlur={() => void commit()} onKeyDown={handleKeyDown} className={inputClass} />
    return <button type="button" aria-label={`Edit ${label}`} onClick={() => { setDraft(value); setEditing(true) }} className="block max-w-full truncate rounded px-1 py-1 text-left text-sm text-neutral-200 underline decoration-dotted decoration-neutral-700 underline-offset-4 transition hover:bg-neutral-900 hover:text-white focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/70">{displayValue || "—"}</button>
}

function EditableSelect({ label, value, options, pending, onSave }: { label: string; value: string; options: Array<{ value: string; label: string }>; pending: boolean; onSave: (value: string) => Promise<boolean> }) {
    return <select aria-label={label} value={value} disabled={pending} onChange={(event) => void onSave(event.target.value)} className={`${inputClass} border-transparent bg-transparent px-1 underline decoration-dotted decoration-neutral-700 underline-offset-4 hover:bg-neutral-900 focus:bg-black`}>
        {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
    </select>
}

export function AppointmentTable({ workspaceId, workspaceSlug, relationshipId, serviceId, initialAppointments, configuration }: Props) {
    const [appointments, setAppointments] = useState(() => sortAppointments(initialAppointments))
    const [adding, setAdding] = useState(false)
    const [newMedium, setNewMedium] = useState<AppointmentMedium>(configuration.mediums[0] ?? "phone")
    const [savingKey, setSavingKey] = useState<string | null>(null)
    const [error, setError] = useState<string | null>(null)
    const hasRemoteMedium = configuration.mediums.some((medium) => medium !== "phone")
    const columns = useMemo(() => [
        "minmax(12rem,1fr)",
        ...configuration.fields.map(() => "minmax(11rem,.8fr)"),
        "minmax(9.5rem,.65fr)",
        "minmax(8.5rem,.55fr)",
        "minmax(9rem,.6fr)",
        ...(hasRemoteMedium ? ["minmax(14rem,.9fr)"] : []),
        "3rem",
    ].join(" "), [configuration.fields, hasRemoteMedium])
    const columnCount = 5 + configuration.fields.length + (hasRemoteMedium ? 1 : 0)

    useEffect(() => {
        const supabase = createSupabaseBrowserClient()
        let refreshTimer: number | null = null
        let active = true
        const refreshAppointments = async () => {
            const { data, error: refreshError } = await supabase.from("appointment_setting_appointments").select(APPOINTMENT_SELECT).eq("workspace_id", workspaceId).eq("relationship_id", relationshipId).eq("service_id", serviceId).order("appointment_at", { ascending: true }).order("created_at", { ascending: true })
            if (active && !refreshError) setAppointments(sortAppointments((data ?? []) as AppointmentSettingAppointment[]))
        }
        const channel = supabase.channel(`appointment-setting:${workspaceId}:${relationshipId}`).on("postgres_changes", { event: "*", schema: "public", table: "appointment_setting_appointments", filter: `relationship_id=eq.${relationshipId}` }, () => {
            if (refreshTimer !== null) window.clearTimeout(refreshTimer)
            refreshTimer = window.setTimeout(() => void refreshAppointments(), 120)
        }).subscribe()
        return () => { active = false; if (refreshTimer !== null) window.clearTimeout(refreshTimer); void supabase.removeChannel(channel) }
    }, [relationshipId, serviceId, workspaceId])

    async function saveField(row: AppointmentSettingAppointment, field: AppointmentUpdateField, value: string) {
        const key = `${row.id}:${field}`
        setSavingKey(key); setError(null)
        try {
            const result = await runWorkspaceMutation(() => updateAppointmentSettingAppointment(workspaceSlug, relationshipId, row.id, field, value, browserTimezone()), { category: "system" })
            if (!result.ok) { setError(result.error); return false }
            setAppointments((current) => sortAppointments(current.map((candidate) => candidate.id === row.id ? result.data! : candidate)))
            return true
        } catch (caught) {
            setError(caught instanceof Error ? caught.message : "We couldn't save that appointment change.")
            return false
        } finally { setSavingKey(null) }
    }

    async function addAppointment(event: FormEvent<HTMLFormElement>) {
        event.preventDefault()
        const form = event.currentTarget
        const formData = new FormData(form)
        const appointmentAt = combineLocalDateTime(String(formData.get("appointment_date") ?? ""), String(formData.get("appointment_time") ?? ""))
        if (!appointmentAt) { setError("Add a valid appointment date and time."); return }
        const meetingMedium = String(formData.get("meeting_medium") ?? newMedium) as AppointmentMedium
        const details = Object.fromEntries(configuration.fields.map((field) => [field.key, String(formData.get(`detail:${field.key}`) ?? "")]))
        setSavingKey("new"); setError(null)
        try {
            const result = await runWorkspaceMutation(() => createAppointmentSettingAppointment(workspaceSlug, relationshipId, {
                contactName: String(formData.get("contact_name") ?? ""),
                appointmentAt,
                appointmentTimezone: browserTimezone(),
                meetingMedium,
                meetingLink: String(formData.get("meeting_link") ?? ""),
                details,
            }), { category: "system" })
            if (!result.ok) { setError(result.error); return }
            setAppointments((current) => sortAppointments([...current.filter((row) => row.id !== result.data!.id), result.data!]))
            form.reset(); setNewMedium(configuration.mediums[0] ?? "phone"); setAdding(false)
        } catch (caught) {
            setError(caught instanceof Error ? caught.message : "We couldn't add this appointment.")
        } finally { setSavingKey(null) }
    }

    async function removeAppointment(appointmentId: string) {
        const result: WorkspaceMutationResult = await deleteAppointmentSettingAppointment(workspaceSlug, relationshipId, appointmentId)
        if (!result.ok) throw new Error(result.error)
        setAppointments((current) => current.filter((row) => row.id !== appointmentId))
    }

    const cellClass = "flex min-w-0 items-center border-l border-neutral-900 px-3 first:border-l-0"
    return <section className="mt-5" aria-labelledby="appointments-heading">
        <div className="mb-3 flex items-end justify-between gap-3"><div><h2 id="appointments-heading" className="text-sm font-medium text-neutral-200">Appointments</h2><p className="mt-1 text-xs text-neutral-600">Changes save when you leave a cell and update for other assigned staff in real time.</p></div><button type="button" onClick={() => { setAdding((current) => !current); setError(null) }} className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-md border border-neutral-700 px-3 text-sm text-neutral-200 transition hover:border-neutral-500 hover:text-white">{adding ? "Cancel" : <><span aria-hidden="true" className="text-base leading-none">+</span> Add appointment</>}</button></div>
        {error ? <p role="alert" className="mb-3 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-200">{error}</p> : null}
        <div className="overflow-x-auto rounded-xl border border-neutral-800 bg-black"><div role="table" aria-label="Appointments" aria-rowcount={appointments.length + 1}>
            <div role="row" className="grid min-w-max h-10 border-b border-neutral-800 bg-neutral-950 text-[11px] font-medium uppercase tracking-wide text-neutral-500" style={{ gridTemplateColumns: columns }}><div role="columnheader" className="flex items-center px-4">Name</div>{configuration.fields.map((field) => <div key={field.key} role="columnheader" className="flex items-center border-l border-neutral-900 px-4">{APPOINTMENT_FIELD_OPTIONS.find((option) => option.key === field.key)?.label}{field.required ? " *" : ""}</div>)}<div role="columnheader" className="flex items-center border-l border-neutral-900 px-4">Date</div><div role="columnheader" className="flex items-center border-l border-neutral-900 px-4">Time</div><div role="columnheader" className="flex items-center border-l border-neutral-900 px-4">Medium</div>{hasRemoteMedium ? <div role="columnheader" className="flex items-center border-l border-neutral-900 px-4">Meeting link</div> : null}<div role="columnheader" className="border-l border-neutral-900"><span className="sr-only">Actions</span></div></div>
            {adding ? <form onSubmit={addAppointment} role="row" className="grid min-w-max min-h-14 border-b border-neutral-800 bg-neutral-900/45" style={{ gridTemplateColumns: columns }}><label role="cell" className="flex items-center px-3"><span className="sr-only">Name</span><input name="contact_name" required autoFocus maxLength={160} placeholder="Lead name" disabled={savingKey === "new"} className={inputClass} /></label>{configuration.fields.map((field) => { const option = APPOINTMENT_FIELD_OPTIONS.find((candidate) => candidate.key === field.key)!; return <label key={field.key} role="cell" className={cellClass}><span className="sr-only">{option.label}</span><input name={`detail:${field.key}`} type={option.inputType} required={field.required} maxLength={field.key === "notes" ? 1_000 : 300} placeholder={option.placeholder} disabled={savingKey === "new"} className={inputClass} /></label> })}<label role="cell" className={cellClass}><span className="sr-only">Date</span><input name="appointment_date" type="date" required disabled={savingKey === "new"} className={inputClass} /></label><label role="cell" className={cellClass}><span className="sr-only">Time</span><input name="appointment_time" type="time" required disabled={savingKey === "new"} className={inputClass} /></label><label role="cell" className={cellClass}><span className="sr-only">Medium</span><select name="meeting_medium" value={newMedium} onChange={(event) => setNewMedium(event.target.value as AppointmentMedium)} required disabled={savingKey === "new"} className={inputClass}>{configuration.mediums.map((medium) => <option key={medium} value={medium}>{APPOINTMENT_MEDIUM_OPTIONS.find((option) => option.key === medium)?.label}</option>)}</select></label>{hasRemoteMedium ? <label role="cell" className={cellClass}><span className="sr-only">Meeting link</span><input name="meeting_link" type="url" required={newMedium !== "phone"} placeholder={newMedium === "phone" ? "Optional" : "https://…"} disabled={savingKey === "new"} className={inputClass} /></label> : null}<div role="cell" className="flex items-center justify-center border-l border-neutral-900"><button type="submit" disabled={savingKey === "new"} aria-label="Save appointment" className="h-8 w-8 text-lg text-neutral-200 hover:text-white disabled:opacity-50">{savingKey === "new" ? "…" : "✓"}</button></div></form> : null}
            {appointments.length ? appointments.map((appointment) => <div key={appointment.id} role="row" className="grid min-w-max min-h-12 border-b border-neutral-900 last:border-b-0 hover:bg-neutral-950" style={{ gridTemplateColumns: columns }}><div role="cell" className="flex min-w-0 items-center px-3"><EditableCell label={`name for ${appointment.contact_name}`} value={appointment.contact_name} displayValue={appointment.contact_name} pending={savingKey === `${appointment.id}:contact_name`} onSave={(value) => saveField(appointment, "contact_name", value)} /></div>{configuration.fields.map((field) => { const option = APPOINTMENT_FIELD_OPTIONS.find((candidate) => candidate.key === field.key)!; const value = detailValue(appointment, field.key); return <div key={field.key} role="cell" className={cellClass}><EditableCell label={`${option.label} for ${appointment.contact_name}`} value={value} displayValue={value} type={option.inputType === "email" ? "email" : option.inputType === "tel" ? "tel" : "text"} required={field.required} pending={savingKey === `${appointment.id}:detail:${field.key}`} onSave={(next) => saveField(appointment, `detail:${field.key}`, next)} /></div> })}<div role="cell" className={cellClass}><EditableCell label={`date for ${appointment.contact_name}`} value={datePart(appointment.appointment_at)} displayValue={dateLabel(appointment.appointment_at, appointment.appointment_timezone)} type="date" pending={savingKey === `${appointment.id}:appointment_at`} onSave={async (date) => { const combined = combineLocalDateTime(date, timePart(appointment.appointment_at)); return combined ? saveField(appointment, "appointment_at", combined) : false }} /></div><div role="cell" className={cellClass}><EditableCell label={`time for ${appointment.contact_name}`} value={timePart(appointment.appointment_at)} displayValue={timeLabel(appointment.appointment_at, appointment.appointment_timezone)} type="time" pending={savingKey === `${appointment.id}:appointment_at`} onSave={async (time) => { const combined = combineLocalDateTime(datePart(appointment.appointment_at), time); return combined ? saveField(appointment, "appointment_at", combined) : false }} /></div><div role="cell" className={cellClass}><EditableSelect label={`medium for ${appointment.contact_name}`} value={appointment.meeting_medium} options={configuration.mediums.map((medium) => ({ value: medium, label: APPOINTMENT_MEDIUM_OPTIONS.find((option) => option.key === medium)?.label ?? medium }))} pending={savingKey === `${appointment.id}:meeting_medium`} onSave={(value) => saveField(appointment, "meeting_medium", value)} /></div>{hasRemoteMedium ? <div role="cell" className={cellClass}><EditableCell label={`meeting link for ${appointment.contact_name}`} value={appointment.meeting_link ?? ""} displayValue={appointment.meeting_link ?? "Add link"} type="url" required={appointment.meeting_medium !== "phone"} pending={savingKey === `${appointment.id}:meeting_link`} onSave={(value) => saveField(appointment, "meeting_link", value)} /></div> : null}<div role="cell" className="flex items-center justify-center border-l border-neutral-900"><ListActionMenu label={`Actions for ${appointment.contact_name}`} actions={[{ label: "Remove appointment", action: () => removeAppointment(appointment.id), danger: true, confirmMessage: `Remove the appointment for ${appointment.contact_name}?` }]} /></div></div>) : !adding ? <div role="row" className="grid min-w-max h-16" style={{ gridTemplateColumns: columns }}><div role="cell" className="flex items-center justify-center px-4 text-sm text-neutral-600" style={{ gridColumn: `span ${columnCount}` }}>No appointments yet.</div></div> : null}
        </div></div><p aria-live="polite" className="mt-2 min-h-4 text-right text-xs text-neutral-600">{savingKey ? "Saving…" : ""}</p>
    </section>
}
