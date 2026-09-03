"use client"

import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react"
import { ListActionMenu } from "@/components/list/ListActionMenu"
import type { AppointmentSettingAppointment } from "@/lib/appointment-setting"
import { createSupabaseBrowserClient } from "@/lib/supabase/browser"
import { runWorkspaceMutation, type WorkspaceMutationResult } from "@/lib/workspace-mutations"
import {
    createAppointmentSettingAppointment,
    deleteAppointmentSettingAppointment,
    updateAppointmentSettingAppointment,
} from "@/app/[workspaceSlug]/appointment-setting/[relationshipId]/actions"

type AppointmentField = "contact_name" | "phone" | "appointment_at"

type Props = {
    workspaceId: string
    workspaceSlug: string
    relationshipId: string
    serviceId: string
    initialAppointments: AppointmentSettingAppointment[]
}

const tableGrid = "grid min-w-[46rem] grid-cols-[minmax(13rem,1fr)_minmax(11rem,0.65fr)_minmax(15rem,0.8fr)_3rem]"
const inputClass = "h-9 w-full rounded-md border border-neutral-700 bg-black px-2.5 text-sm text-white outline-none transition placeholder:text-neutral-700 focus:border-neutral-400 disabled:opacity-60"

function browserTimezone() {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"
}

function localDateTimeValue(value: string) {
    const date = new Date(value)
    if (Number.isNaN(date.getTime())) return ""
    const pad = (part: number) => String(part).padStart(2, "0")
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function appointmentTimeLabel(value: string, timeZone: string) {
    const date = new Date(value)
    if (Number.isNaN(date.getTime())) return "Invalid time"
    try {
        return new Intl.DateTimeFormat("en-IE", {
            day: "numeric",
            month: "short",
            year: "numeric",
            hour: "2-digit",
            minute: "2-digit",
            timeZone,
            timeZoneName: "short",
        }).format(date)
    } catch {
        return new Intl.DateTimeFormat("en-IE", {
            day: "numeric",
            month: "short",
            year: "numeric",
            hour: "2-digit",
            minute: "2-digit",
            timeZone: "UTC",
            timeZoneName: "short",
        }).format(date)
    }
}

function sortAppointments(rows: AppointmentSettingAppointment[]) {
    return [...rows].sort((left, right) => (
        left.appointment_at.localeCompare(right.appointment_at)
        || left.created_at.localeCompare(right.created_at)
    ))
}

function EditableCell({
    label,
    value,
    displayValue,
    type = "text",
    pending,
    onSave,
}: {
    label: string
    value: string
    displayValue: string
    type?: "text" | "tel" | "datetime-local"
    pending: boolean
    onSave: (value: string) => Promise<boolean>
}) {
    const [editing, setEditing] = useState(false)
    const [draft, setDraft] = useState(value)
    const committing = useRef(false)

    async function commit() {
        if (committing.current) return
        const cleaned = draft.trim()
        if (!cleaned || cleaned === value) {
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
        if (event.key === "Escape") {
            event.preventDefault()
            setDraft(value)
            setEditing(false)
        }
        if (event.key === "Enter") {
            event.preventDefault()
            void commit()
        }
    }

    if (editing) return <input
        type={type}
        aria-label={label}
        autoFocus
        required
        disabled={pending}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => void commit()}
        onKeyDown={handleKeyDown}
        className={inputClass}
    />

    return <button
        type="button"
        aria-label={`Edit ${label}`}
        onClick={() => {
            setDraft(type === "datetime-local" ? localDateTimeValue(value) : value)
            setEditing(true)
        }}
        className="block max-w-full truncate rounded px-1 py-1 text-left text-sm text-neutral-200 underline decoration-dotted decoration-neutral-700 underline-offset-4 transition hover:bg-neutral-900 hover:text-white focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/70"
    >{displayValue}</button>
}

export function AppointmentTable({ workspaceId, workspaceSlug, relationshipId, serviceId, initialAppointments }: Props) {
    const [appointments, setAppointments] = useState(() => sortAppointments(initialAppointments))
    const [adding, setAdding] = useState(false)
    const [savingKey, setSavingKey] = useState<string | null>(null)
    const [error, setError] = useState<string | null>(null)

    useEffect(() => {
        const supabase = createSupabaseBrowserClient()
        let refreshTimer: number | null = null
        let active = true
        const refreshAppointments = async () => {
            const { data, error: refreshError } = await supabase
                .from("appointment_setting_appointments")
                .select("id, workspace_id, relationship_id, service_id, contact_name, phone, appointment_at, appointment_timezone, created_by, updated_by, created_at, updated_at")
                .eq("workspace_id", workspaceId)
                .eq("relationship_id", relationshipId)
                .eq("service_id", serviceId)
                .order("appointment_at", { ascending: true })
                .order("created_at", { ascending: true })
            if (active && !refreshError) setAppointments(sortAppointments((data ?? []) as AppointmentSettingAppointment[]))
        }
        const channel = supabase
            .channel(`appointment-setting:${workspaceId}:${relationshipId}`)
            .on("postgres_changes", {
                event: "*",
                schema: "public",
                table: "appointment_setting_appointments",
                filter: `relationship_id=eq.${relationshipId}`,
            }, () => {
                if (refreshTimer !== null) window.clearTimeout(refreshTimer)
                refreshTimer = window.setTimeout(() => void refreshAppointments(), 120)
            })
            .subscribe()
        return () => {
            active = false
            if (refreshTimer !== null) window.clearTimeout(refreshTimer)
            void supabase.removeChannel(channel)
        }
    }, [relationshipId, serviceId, workspaceId])

    async function saveField(row: AppointmentSettingAppointment, field: AppointmentField, value: string) {
        const key = `${row.id}:${field}`
        setSavingKey(key)
        setError(null)
        let actionValue = value
        const timezone = browserTimezone()
        if (field === "appointment_at") {
            const parsed = new Date(value)
            if (Number.isNaN(parsed.getTime())) {
                setError("Add a valid appointment date and time.")
                setSavingKey(null)
                return false
            }
            actionValue = parsed.toISOString()
        }
        try {
            const result = await runWorkspaceMutation(
                () => updateAppointmentSettingAppointment(workspaceSlug, relationshipId, row.id, field, actionValue, timezone),
                { category: "system" },
            )
            if (!result.ok) {
                setError(result.error)
                return false
            }
            setAppointments((current) => sortAppointments(current.map((candidate) => candidate.id === row.id ? result.data! : candidate)))
            return true
        } catch (caught) {
            setError(caught instanceof Error ? caught.message : "We couldn't save that appointment change.")
            return false
        } finally {
            setSavingKey(null)
        }
    }

    async function addAppointment(event: FormEvent<HTMLFormElement>) {
        event.preventDefault()
        const form = event.currentTarget
        const formData = new FormData(form)
        const localTime = String(formData.get("appointment_at") ?? "")
        const parsed = new Date(localTime)
        if (Number.isNaN(parsed.getTime())) {
            setError("Add a valid appointment date and time.")
            return
        }
        setSavingKey("new")
        setError(null)
        try {
            const result = await runWorkspaceMutation(() => createAppointmentSettingAppointment(workspaceSlug, relationshipId, {
                contactName: String(formData.get("contact_name") ?? ""),
                phone: String(formData.get("phone") ?? ""),
                appointmentAt: parsed.toISOString(),
                appointmentTimezone: browserTimezone(),
            }), { category: "system" })
            if (!result.ok) {
                setError(result.error)
                return
            }
            setAppointments((current) => sortAppointments([...current.filter((row) => row.id !== result.data!.id), result.data!]))
            form.reset()
            setAdding(false)
        } catch (caught) {
            setError(caught instanceof Error ? caught.message : "We couldn't add this appointment.")
        } finally {
            setSavingKey(null)
        }
    }

    async function removeAppointment(appointmentId: string) {
        const result: WorkspaceMutationResult = await deleteAppointmentSettingAppointment(workspaceSlug, relationshipId, appointmentId)
        if (!result.ok) throw new Error(result.error)
        setAppointments((current) => current.filter((row) => row.id !== appointmentId))
    }

    return <section className="mt-5" aria-labelledby="appointments-heading">
        <div className="mb-3 flex items-end justify-between gap-3">
            <div>
                <h2 id="appointments-heading" className="text-sm font-medium text-neutral-200">Appointments</h2>
                <p className="mt-1 text-xs text-neutral-600">Changes save when you leave a cell and update for other assigned staff in real time.</p>
            </div>
            <button type="button" onClick={() => { setAdding((current) => !current); setError(null) }} className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-md border border-neutral-700 px-3 text-sm text-neutral-200 transition hover:border-neutral-500 hover:text-white">
                {adding ? "Cancel" : <><span aria-hidden="true" className="text-base leading-none">+</span> Add appointment</>}
            </button>
        </div>

        {error ? <p role="alert" className="mb-3 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-200">{error}</p> : null}

        <div className="overflow-x-auto rounded-xl border border-neutral-800 bg-black">
            <div role="table" aria-label="Appointments" aria-rowcount={appointments.length + 1}>
                <div role="row" className={`${tableGrid} h-10 border-b border-neutral-800 bg-neutral-950 text-[11px] font-medium uppercase tracking-wide text-neutral-500`}>
                    <div role="columnheader" className="flex items-center px-4">Name</div>
                    <div role="columnheader" className="flex items-center border-l border-neutral-900 px-4">Phone</div>
                    <div role="columnheader" className="flex items-center border-l border-neutral-900 px-4">Appointment time</div>
                    <div role="columnheader" className="border-l border-neutral-900"><span className="sr-only">Actions</span></div>
                </div>

                {adding ? <form onSubmit={addAppointment} role="row" className={`${tableGrid} min-h-14 border-b border-neutral-800 bg-neutral-900/45`}>
                    <label role="cell" className="flex items-center px-3"><span className="sr-only">Name</span><input name="contact_name" required autoFocus maxLength={160} placeholder="Lead name" disabled={savingKey === "new"} className={inputClass} /></label>
                    <label role="cell" className="flex items-center border-l border-neutral-900 px-3"><span className="sr-only">Phone</span><input name="phone" type="tel" required maxLength={64} placeholder="Phone number" disabled={savingKey === "new"} className={inputClass} /></label>
                    <label role="cell" className="flex items-center border-l border-neutral-900 px-3"><span className="sr-only">Appointment time</span><input name="appointment_at" type="datetime-local" required disabled={savingKey === "new"} className={inputClass} /></label>
                    <div role="cell" className="flex items-center justify-center border-l border-neutral-900"><button type="submit" disabled={savingKey === "new"} aria-label="Save appointment" className="h-8 w-8 text-lg text-neutral-200 hover:text-white disabled:opacity-50">{savingKey === "new" ? "…" : "✓"}</button></div>
                </form> : null}

                {appointments.length ? appointments.map((appointment) => <div key={appointment.id} role="row" className={`${tableGrid} min-h-12 border-b border-neutral-900 last:border-b-0 hover:bg-neutral-950`}>
                    <div role="cell" className="flex min-w-0 items-center px-3">
                        <EditableCell label={`name for ${appointment.contact_name}`} value={appointment.contact_name} displayValue={appointment.contact_name} pending={savingKey === `${appointment.id}:contact_name`} onSave={(value) => saveField(appointment, "contact_name", value)} />
                    </div>
                    <div role="cell" className="flex min-w-0 items-center border-l border-neutral-900 px-3">
                        <EditableCell label={`phone for ${appointment.contact_name}`} value={appointment.phone} displayValue={appointment.phone} type="tel" pending={savingKey === `${appointment.id}:phone`} onSave={(value) => saveField(appointment, "phone", value)} />
                    </div>
                    <div role="cell" className="flex min-w-0 items-center border-l border-neutral-900 px-3">
                        <EditableCell label={`appointment time for ${appointment.contact_name}`} value={appointment.appointment_at} displayValue={appointmentTimeLabel(appointment.appointment_at, appointment.appointment_timezone)} type="datetime-local" pending={savingKey === `${appointment.id}:appointment_at`} onSave={(value) => saveField(appointment, "appointment_at", value)} />
                    </div>
                    <div role="cell" className="flex items-center justify-center border-l border-neutral-900">
                        <ListActionMenu label={`Actions for ${appointment.contact_name}`} actions={[{
                            label: "Remove appointment",
                            action: () => removeAppointment(appointment.id),
                            danger: true,
                            confirmMessage: `Remove the appointment for ${appointment.contact_name}?`,
                        }]} />
                    </div>
                </div>) : !adding ? <div role="row" className={`${tableGrid} h-16`}><div role="cell" className="col-span-4 flex items-center justify-center px-4 text-sm text-neutral-600">No appointments yet.</div></div> : null}
            </div>
        </div>
        <p aria-live="polite" className="mt-2 min-h-4 text-right text-xs text-neutral-600">{savingKey ? "Saving…" : ""}</p>
    </section>
}
