"use client"

import { useEffect, useLayoutEffect, useMemo, useRef, useState, useTransition, type ReactNode } from "react"
import { createPortal } from "react-dom"
import { useRouter } from "next/navigation"
import { Assignee, RoundPill, Status } from "@/components/ui"
import { Avatar } from "@/components/account/Avatar"
import { postGanttSync } from "@/lib/ui/gantt-sync"
import { workItemPrioritySelectionLabel, workItemPrioritySelectionOptions } from "@/lib/work-item-priority"
import {
    updateWorkItemAssignees,
    updateWorkItemDependencies,
    updateWorkItemDescription,
    updateWorkItemParent,
    updateWorkItemPriority,
    updateWorkItemLinks,
    updateWorkItemSchedule,
} from "./actions"

type Person = { user_id: string; username: string; avatar_url: string | null }
type WorkOption = { id: string; title: string; status: string }
type RelationshipOption = { id: string; label: string }
type KeyResultOption = {
    id: string
    code: string
    name: string
    objective: string
    unit: "number" | "percentage" | "currency" | "duration"
    currency_code: string | null
    expected_movement: number | null
    impact_hypothesis: string | null
}
type KeyResultEstimate = { keyResultId: string; expectedMovement: string; impactHypothesis: string }
let activePopupTrigger: HTMLElement | null = null

type Props = {
    workspaceSlug: string
    workItemId: string
    status: string
    statusLabel: string
    statusTone: "grey" | "yellow" | "green" | "red"
    plannedStartDate: string | null
    plannedStartTime: string | null
    dueDate: string | null
    dueTime: string | null
    actualStartAt: string | null
    actualStartHasTime: boolean
    actualCompletedAt: string | null
    actualCompletedHasTime: boolean
    description: string | null
    assignees: Person[]
    executionOwnerId: string | null
    creator: Person | null
    members: Person[]
    parent: WorkOption | null
    parentId: string | null
    waitsForParent: boolean
    dependencies: WorkOption[]
    manualDependencyIds: string[]
    workOptions: WorkOption[]
    relationships: RelationshipOption[]
    relationshipOptions: RelationshipOption[]
    relationshipsLocked: boolean
    keyResults: KeyResultOption[]
    keyResultOptions: KeyResultOption[]
    linksLocked: boolean
    priorityOverride: number | null
}

function displayDate(value: string | null, time: string | null = null) {
    if (!value) return "Not set"
    const date = new Date(value.includes("T") ? value : `${value}T12:00:00`)
    const formatted = new Intl.DateTimeFormat("en-IE", { day: "numeric", month: "short", year: "numeric" }).format(date)
    return time ? `${formatted}, ${time.slice(0, 5)}` : formatted
}

function dateInputValue(value: string | null) {
    if (!value) return ""
    if (value.includes("T")) {
        const parsed = new Date(value)
        if (!Number.isNaN(parsed.getTime())) return `${String(parsed.getDate()).padStart(2, "0")}/${String(parsed.getMonth() + 1).padStart(2, "0")}/${parsed.getFullYear()}`
    }
    const [year, month, day] = value.slice(0, 10).split("-")
    return `${day}/${month}/${year}`
}

function dateStorageValue(value: string) {
    if (!value.trim()) return null
    const match = value.trim().match(/^(\d{1,2})[\/\-,\s]+(\d{1,2})[\/\-,\s]+(\d{2}|\d{4})$/)
    if (!match) throw new Error("Enter a date as DD/MM/YYYY")
    const [, rawDay, rawMonth, rawYear] = match
    const day = rawDay.padStart(2, "0")
    const month = rawMonth.padStart(2, "0")
    const year = rawYear.length === 2 ? `20${rawYear}` : rawYear
    const date = new Date(`${year}-${month}-${day}T12:00:00Z`)
    if (date.getUTCFullYear() !== Number(year) || date.getUTCMonth() + 1 !== Number(month) || date.getUTCDate() !== Number(day)) throw new Error("Enter a valid date")
    return `${year}-${month}-${day}`
}

function timeStorageValue(value: string) {
    if (!value.trim()) return null
    const match = value.trim().match(/^(\d{1,2})[:.,\s]+(\d{1,2})$/)
    if (!match) throw new Error("Enter a time as HH:MM")
    const hour = Number(match[1])
    const minute = Number(match[2])
    if (hour > 23 || minute > 59) throw new Error("Enter a valid time")
    return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`
}

function actualIsoValue(dateValue: string, timeValue: string) {
    const date = dateStorageValue(dateValue)
    if (!date) return null
    const time = timeStorageValue(timeValue) ?? "00:00"
    const [year, month, day] = date.split("-").map(Number)
    const [hours, minutes] = time.split(":").map(Number)
    return new Date(year, month - 1, day, hours, minutes).toISOString()
}

function timeInputValue(value: string | null) {
    if (!value) return ""
    if (value.includes("T")) {
        const parsed = new Date(value)
        if (!Number.isNaN(parsed.getTime())) return `${String(parsed.getHours()).padStart(2, "0")}:${String(parsed.getMinutes()).padStart(2, "0")}`
    }
    return value.slice(0, 5)
}

type FieldIcon = "status" | "schedule" | "user" | "parent" | "dependency" | "relationship" | "priority" | "description"

function Icon({ kind }: { kind: FieldIcon }) {
    const paths: Record<FieldIcon, ReactNode> = {
        status: <><circle cx="12" cy="12" r="7" /><circle cx="12" cy="12" r="2" /></>,
        schedule: <><path d="M7 3v3M17 3v3M4 9h16" /><rect x="4" y="5" width="16" height="15" rx="2" /></>,
        user: <><circle cx="12" cy="8" r="4" /><path d="M4.5 20c.8-4 3.3-6 7.5-6s6.7 2 7.5 6" /></>,
        parent: <><path d="M6 5h5v5H6zM13 14h5v5h-5zM8.5 10v2a4 4 0 0 0 4 4h.5" /></>,
        dependency: <><circle cx="7" cy="7" r="3" /><circle cx="17" cy="17" r="3" /><path d="M9.5 9.5l5 5" /></>,
        relationship: <><circle cx="8" cy="9" r="3" /><circle cx="16" cy="9" r="3" /><path d="M2.5 20c.5-3.3 2.3-5 5.5-5M21.5 20c-.5-3.3-2.3-5-5.5-5M10 17h4" /></>,
        priority: <><path d="M6 21V4M6 5h11l-2 4 2 4H6" /></>,
        description: <><path d="M5 5h14M5 9h14M5 13h10M5 17h12" /></>,
    }
    return <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4 shrink-0">{paths[kind]}</svg>
}

function Field({ label, icon, children, className = "" }: { label: string; icon: FieldIcon; children: ReactNode; className?: string }) {
    return <div className={`grid min-h-10 grid-cols-[8rem_minmax(0,1fr)] items-start gap-2 border-b border-neutral-900 py-2 sm:grid-cols-[9rem_minmax(0,1fr)] ${className}`}><p className="flex items-center gap-2 pt-0.5 text-sm text-neutral-500"><Icon kind={icon} /><span>{label}</span></p><div className="min-w-0 text-sm text-neutral-200">{children}</div></div>
}

function Search({ value, onChange, placeholder }: { value: string; onChange: (value: string) => void; placeholder: string }) {
    return <input autoFocus value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} className="h-9 w-full border-b border-neutral-800 bg-transparent px-2.5 text-sm text-white outline-none placeholder:text-neutral-600" />
}

function Popup({ children, className = "w-72" }: { children: ReactNode; className?: string }) {
    const popupRef = useRef<HTMLDivElement>(null)
    const [position, setPosition] = useState<{ left: number; top: number } | null>(null)
    const parentDocument = typeof window !== "undefined" && window.parent !== window ? window.parent.document : typeof document !== "undefined" ? document : null

    useLayoutEffect(() => {
        const trigger = activePopupTrigger
        if (!trigger) return
        const triggerRect = trigger.getBoundingClientRect()
        const frameRect = window.frameElement?.getBoundingClientRect() ?? { left: 0, top: 0 }
        const popupWidth = popupRef.current?.offsetWidth ?? 320
        const popupHeight = popupRef.current?.offsetHeight ?? 240
        const viewportWidth = window.parent === window ? window.innerWidth : window.parent.innerWidth
        const viewportHeight = window.parent === window ? window.innerHeight : window.parent.innerHeight
        const desiredLeft = frameRect.left + triggerRect.left
        const below = frameRect.top + triggerRect.bottom + 4
        const boundedHeight = Math.min(popupHeight, viewportHeight - 16)
        const above = frameRect.top + triggerRect.top - boundedHeight - 4
        setPosition({
            left: Math.max(8, Math.min(desiredLeft, viewportWidth - popupWidth - 8)),
            top: Math.max(8, Math.min(below + boundedHeight <= viewportHeight - 8 ? below : above, viewportHeight - boundedHeight - 8)),
        })
    }, [])

    if (!parentDocument) return null
    return createPortal(<div ref={popupRef} data-work-item-popup style={position ?? { visibility: "hidden" }} className={`fixed z-[100] max-h-[calc(100vh-1rem)] max-w-[calc(100vw-1rem)] overflow-y-auto rounded-xl border border-neutral-700 bg-neutral-950 shadow-2xl shadow-black/60 ${className}`}>{children}</div>, parentDocument.body)
}

function PopupFooter({ onSave, onClear, pending }: { onSave: () => void; onClear?: () => void; pending: boolean }) {
    return <div className="flex justify-end gap-1.5 border-t border-neutral-800 p-1.5">{onClear ? <button type="button" disabled={pending} onClick={onClear} className="h-8 px-2 text-xs text-neutral-400 hover:text-white disabled:opacity-50">Clear</button> : null}<button type="button" disabled={pending} onClick={onSave} className="h-8 rounded-md bg-white px-3 text-xs font-medium text-black disabled:opacity-50">{pending ? "Saving…" : "Save"}</button></div>
}

function MinimalDateTimeInputs({ date, time, onDateChange, onTimeChange, timeLabel }: { date: string; time: string; onDateChange: (value: string) => void; onTimeChange: (value: string) => void; timeLabel: string }) {
    const inputClass = "h-9 min-w-0 w-full rounded-md border border-neutral-700 bg-black px-2 text-sm text-white caret-neutral-300 outline-none placeholder:text-neutral-600 selection:bg-neutral-600 selection:text-white"
    return <div className="grid grid-cols-[1fr_6rem] gap-1.5"><input autoFocus type="text" maxLength={12} value={date} onChange={(event) => onDateChange(event.target.value)} aria-label="Date" placeholder="DD/MM/YYYY" className={inputClass} /><input type="text" maxLength={5} value={time} onChange={(event) => onTimeChange(event.target.value)} aria-label={timeLabel} placeholder="––:––" className={inputClass} /></div>
}

export function InlineWorkItemFields(props: Props) {
    const router = useRouter()
    const [open, setOpen] = useState<string | null>(null)
    const [query, setQuery] = useState("")
    const [error, setError] = useState<string | null>(null)
    const [pending, startTransition] = useTransition()
    const completed = props.status === "done"
    const started = Boolean(props.actualStartAt)
    const [startDate, setStartDate] = useState(dateInputValue(started ? props.actualStartAt : props.plannedStartDate))
    const [startTime, setStartTime] = useState(timeInputValue(started ? props.actualStartHasTime ? props.actualStartAt : null : props.plannedStartTime))
    const [dueDate, setDueDate] = useState(dateInputValue(completed ? props.actualCompletedAt : props.dueDate))
    const [dueTime, setDueTime] = useState(timeInputValue(completed && props.actualCompletedHasTime ? props.actualCompletedAt : completed ? null : props.dueTime))
    const [assigneeIds, setAssigneeIds] = useState(props.assignees.map((person) => person.user_id))
    const [executionOwnerId, setExecutionOwnerId] = useState(props.executionOwnerId)
    const [parentId, setParentId] = useState(props.parentId ?? "")
    const [waitForParent, setWaitForParent] = useState(props.waitsForParent || !props.parentId)
    const [dependencyIds, setDependencyIds] = useState(props.manualDependencyIds)
    const [relationshipIds, setRelationshipIds] = useState(props.relationships.map((relationship) => relationship.id))
    const [keyResultEstimates, setKeyResultEstimates] = useState<KeyResultEstimate[]>(props.keyResults.map((result) => ({ keyResultId: result.id, expectedMovement: result.expected_movement === null ? "" : String(result.expected_movement), impactHypothesis: result.impact_hypothesis ?? "" })))
    const [description, setDescription] = useState(props.description ?? "")
    const descriptionRef = useRef<HTMLTextAreaElement>(null)

    useEffect(() => {
        function close(event: MouseEvent) {
            const target = event.target as Element
            if (!target.closest("[data-work-item-popup]") && !target.closest("[data-work-item-popup-trigger]")) setOpen(null)
        }
        document.addEventListener("mousedown", close)
        const parentDocument = window.parent !== window ? window.parent.document : null
        parentDocument?.addEventListener("mousedown", close)
        return () => {
            document.removeEventListener("mousedown", close)
            parentDocument?.removeEventListener("mousedown", close)
        }
    }, [])

    useEffect(() => {
        const textarea = descriptionRef.current
        if (!textarea) return
        textarea.style.height = "auto"
        textarea.style.height = `${Math.max(80, textarea.scrollHeight)}px`
    }, [description])

    function toggle(name: string) {
        activePopupTrigger = document.activeElement instanceof HTMLElement ? document.activeElement : null
        setError(null); setQuery("")
        if (open !== name) {
            setStartDate(dateInputValue(started ? props.actualStartAt : props.plannedStartDate))
            setStartTime(timeInputValue(started ? props.actualStartHasTime ? props.actualStartAt : null : props.plannedStartTime))
            setDueDate(dateInputValue(completed ? props.actualCompletedAt : props.dueDate))
            setDueTime(timeInputValue(completed && props.actualCompletedHasTime ? props.actualCompletedAt : completed ? null : props.dueTime))
            setAssigneeIds(props.assignees.map((person) => person.user_id))
            setExecutionOwnerId(props.executionOwnerId)
            setParentId(props.parentId ?? "")
            setWaitForParent(props.waitsForParent || !props.parentId)
            setDependencyIds(props.manualDependencyIds)
            setRelationshipIds(props.relationships.map((relationship) => relationship.id))
            setKeyResultEstimates(props.keyResults.map((result) => ({ keyResultId: result.id, expectedMovement: result.expected_movement === null ? "" : String(result.expected_movement), impactHypothesis: result.impact_hypothesis ?? "" })))
        }
        setOpen((current) => current === name ? null : name)
    }
    function save(action: () => Promise<void>) {
        setError(null)
        setOpen(null)
        startTransition(async () => {
            try { await action(); router.refresh(); postGanttSync(props.workspaceSlug) }
            catch (cause) { setError(cause instanceof Error ? cause.message : "Could not save this field") }
        })
    }
    function toggleId(values: string[], id: string, setter: (values: string[]) => void) { setter(values.includes(id) ? values.filter((value) => value !== id) : [...values, id]) }
    function toggleAssignee(id: string) {
        setAssigneeIds((current) => {
            if (current.includes(id)) {
                const next = current.filter((value) => value !== id)
                if (executionOwnerId === id) setExecutionOwnerId(next[0] ?? null)
                return next
            }
            if (!executionOwnerId) setExecutionOwnerId(id)
            return [...current, id]
        })
    }
    function toggleKeyResult(id: string) {
        setKeyResultEstimates((current) => current.some((link) => link.keyResultId === id)
            ? current.filter((link) => link.keyResultId !== id)
            : [...current, { keyResultId: id, expectedMovement: "", impactHypothesis: "" }])
    }
    function updateKeyResultEstimate(id: string, change: Partial<Omit<KeyResultEstimate, "keyResultId">>) {
        setKeyResultEstimates((current) => current.map((link) => link.keyResultId === id ? { ...link, ...change } : link))
    }
    function saveLinks() {
        if (keyResultEstimates.length && !props.executionOwnerId) {
            setError("Choose an execution owner before linking this work item to a Key Result")
            return
        }
        if (keyResultEstimates.some((link) => !Number.isFinite(Number(link.expectedMovement)) || Number(link.expectedMovement) <= 0)) {
            setError("Every linked Key Result needs a positive expected movement")
            return
        }
        if (keyResultEstimates.some((link) => !link.impactHypothesis.trim())) {
            setError("Every linked Key Result needs an impact hypothesis")
            return
        }
        save(() => updateWorkItemLinks(props.workspaceSlug, props.workItemId, relationshipIds, keyResultEstimates.map((link) => ({ keyResultId: link.keyResultId, expectedMovement: Number(link.expectedMovement), impactHypothesis: link.impactHypothesis.trim() }))))
    }
    const filteredMembers = useMemo(() => props.members.filter((person) => person.username.toLowerCase().includes(query.toLowerCase())), [props.members, query])
    const filteredWork = useMemo(() => props.workOptions.filter((item) => item.title.toLowerCase().includes(query.toLowerCase())), [props.workOptions, query])
    const filteredRelationships = useMemo(() => props.relationshipOptions.filter((relationship) => relationship.label.toLowerCase().includes(query.toLowerCase())), [props.relationshipOptions, query])
    const filteredKeyResults = useMemo(() => props.keyResultOptions.filter((result) => `${result.code} ${result.name} ${result.objective}`.toLowerCase().includes(query.toLowerCase())), [props.keyResultOptions, query])

    return (
        <div className="relative">
            <section className="mt-3 py-1">
                <div className="grid grid-cols-1 lg:grid-cols-2">
                    <div className="contents">
                        <Field label="Status" icon="status" className="lg:col-start-1 lg:row-start-1"><Status label={props.statusLabel} tone={props.statusTone} /></Field>
                        <Field label="Schedule" icon="schedule" className="lg:col-start-1 lg:row-start-2">
                            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                                <div className="flex items-center gap-2 whitespace-nowrap">
                                <div className="relative">
                                    <button data-work-item-popup-trigger type="button" onClick={() => toggle("start")} className="rounded py-0.5 hover:text-white">{started ? displayDate(props.actualStartAt, props.actualStartHasTime ? timeInputValue(props.actualStartAt) : null) : displayDate(props.plannedStartDate, props.plannedStartTime)}</button>
                                    {open === "start" ? <Popup className="w-64"><div className="p-2.5"><p className="mb-1.5 text-xs text-neutral-500">{started ? "Actual start" : "Planned start"}</p><MinimalDateTimeInputs date={startDate} time={startTime} onDateChange={setStartDate} onTimeChange={setStartTime} timeLabel="Optional start time" /></div><PopupFooter pending={pending} onClear={startDate || startTime ? () => { setStartDate(""); setStartTime("") } : undefined} onSave={() => save(() => updateWorkItemSchedule(props.workspaceSlug, props.workItemId, dateStorageValue(startDate), timeStorageValue(startTime), dateStorageValue(dueDate), timeStorageValue(dueTime), completed, started, started ? actualIsoValue(startDate, startTime) : undefined, completed ? actualIsoValue(dueDate, dueTime) : undefined))} /></Popup> : null}
                                </div>
                                <span className="text-neutral-600">→</span>
                                </div>
                                <div className="flex items-center gap-2 whitespace-nowrap">
                                <span className="text-neutral-500">{props.status === "done" ? "Finished" : "Due"}</span>
                                <div className="relative">
                                    <button data-work-item-popup-trigger type="button" onClick={() => toggle("due")} className="rounded py-0.5 hover:text-white">{completed ? displayDate(props.actualCompletedAt, props.actualCompletedHasTime ? timeInputValue(props.actualCompletedAt) : null) : displayDate(props.dueDate, props.dueTime)}</button>
                                    {open === "due" ? <Popup className="w-64"><div className="p-2.5"><p className="mb-1.5 text-xs text-neutral-500">{completed ? "Finished" : "Due date"}</p><MinimalDateTimeInputs date={dueDate} time={dueTime} onDateChange={setDueDate} onTimeChange={setDueTime} timeLabel="Optional finish time" /></div><PopupFooter pending={pending} onClear={dueDate || dueTime ? () => { setDueDate(""); setDueTime("") } : undefined} onSave={() => save(() => updateWorkItemSchedule(props.workspaceSlug, props.workItemId, dateStorageValue(startDate), timeStorageValue(startTime), dateStorageValue(dueDate), timeStorageValue(dueTime), completed, started, started ? actualIsoValue(startDate, startTime) : undefined, completed ? actualIsoValue(dueDate, dueTime) : undefined))} /></Popup> : null}
                                </div>
                                </div>
                            </div>
                        </Field>
                        <Field label="Assigned to" icon="user" className="lg:col-start-1 lg:row-start-3">
                            <div className="relative inline-flex max-w-full flex-wrap gap-1.5">
                                <button data-work-item-popup-trigger type="button" onClick={() => toggle("assignees")} className="flex max-w-full flex-wrap gap-1.5 rounded p-0 hover:opacity-90">
                                    {props.assignees.length ? [...props.assignees].sort((left, right) => Number(right.user_id === props.executionOwnerId) - Number(left.user_id === props.executionOwnerId)).map((person) => <span key={person.user_id} className="inline-flex items-center gap-1"><Assignee name={person.username} avatarSrc={person.avatar_url} />{person.user_id === props.executionOwnerId ? <span className="text-[10px] uppercase tracking-wide text-neutral-500">Owner</span> : null}</span>) : <span className="text-neutral-600">Unassigned</span>}
                                </button>
                                {open === "assignees" ? <Popup className="w-80"><Search value={query} onChange={setQuery} placeholder="Search users…" /><p className="border-b border-neutral-800 px-2.5 py-2 text-xs leading-5 text-neutral-500">The execution owner drives completion forecasts. Additional assignees are collaborators.</p><div className="max-h-64 overflow-y-auto p-1">{filteredMembers.map((person) => { const assigned = assigneeIds.includes(person.user_id); const owner = executionOwnerId === person.user_id; return <div key={person.user_id} className="flex items-center gap-1 rounded-lg hover:bg-neutral-900"><button type="button" onClick={() => toggleAssignee(person.user_id)} className="flex min-w-0 flex-1 items-center gap-2 px-1.5 py-2 text-left"><Avatar src={person.avatar_url} name={person.username} className="h-7 w-7" /><span className="min-w-0 flex-1 truncate text-sm">{person.username}</span><span className="text-sm text-neutral-500">{assigned ? "✓" : ""}</span></button>{assigned ? <button type="button" onClick={() => setExecutionOwnerId(person.user_id)} className={`mr-1 rounded px-2 py-1 text-[11px] ${owner ? "bg-neutral-800 text-white" : "text-neutral-500 hover:text-white"}`}>{owner ? "Owner" : "Make owner"}</button> : null}</div> })}</div><PopupFooter pending={pending} onClear={assigneeIds.length ? () => { setAssigneeIds([]); setExecutionOwnerId(null) } : undefined} onSave={() => save(() => updateWorkItemAssignees(props.workspaceSlug, props.workItemId, assigneeIds, executionOwnerId))} /></Popup> : null}
                            </div>
                        </Field>
                        <Field label="Created by" icon="user" className="lg:col-start-1 lg:row-start-4">{props.creator ? <Assignee name={props.creator.username} avatarSrc={props.creator.avatar_url} /> : <span className="text-neutral-600">System or imported</span>}</Field>
                    </div>
                    <div className="contents">
                        <Field label="Parent" icon="parent" className="lg:col-start-2 lg:row-start-1 lg:border-l lg:border-neutral-900 lg:pl-8"><div className="relative inline-block max-w-full"><button data-work-item-popup-trigger type="button" onClick={() => toggle("parent")} className="block max-w-full rounded py-0.5 text-left hover:text-white">{props.parent ? <span className="block truncate">{props.parent.title}</span> : "None"}</button>{open === "parent" ? <Popup className="w-80"><Search value={query} onChange={setQuery} placeholder="Search work items…" /><div className="max-h-56 overflow-y-auto p-1"><button type="button" onClick={() => setParentId("")} className="w-full rounded-lg px-1.5 py-2 text-left text-sm text-neutral-500 hover:bg-neutral-900">No parent</button>{filteredWork.map((item) => <button type="button" key={item.id} onClick={() => setParentId(item.id)} className="flex w-full gap-2 rounded-lg px-1.5 py-2 text-left text-sm hover:bg-neutral-900"><span className="min-w-0 flex-1 truncate">{item.title}</span><span>{parentId === item.id ? "✓" : ""}</span></button>)}</div><label className="flex items-center gap-2 border-t border-neutral-800 px-2.5 py-2 text-xs text-neutral-300"><input type="checkbox" checked={waitForParent} disabled={!parentId} onChange={(event) => setWaitForParent(event.target.checked)} /> Wait for parent</label><PopupFooter pending={pending} onClear={parentId ? () => { setParentId(""); setWaitForParent(false) } : undefined} onSave={() => save(() => updateWorkItemParent(props.workspaceSlug, props.workItemId, parentId || null, Boolean(parentId && waitForParent)))} /></Popup> : null}</div></Field>
                        <Field label="Dependencies" icon="dependency" className="lg:col-start-2 lg:row-start-2 lg:border-l lg:border-neutral-900 lg:pl-8"><div className="relative inline-block max-w-full"><button data-work-item-popup-trigger type="button" onClick={() => toggle("dependencies")} className="max-w-full rounded py-0.5 text-left hover:text-white">{props.dependencies.length ? props.dependencies.map((item) => item.title).join(", ") : "None"}</button>{open === "dependencies" ? <Popup className="w-80"><Search value={query} onChange={setQuery} placeholder="Search work items…" /><div className="max-h-64 overflow-y-auto p-1">{filteredWork.map((item) => <button type="button" key={item.id} disabled={item.id === parentId} onClick={() => toggleId(dependencyIds, item.id, setDependencyIds)} className="flex w-full gap-2 rounded-lg px-1.5 py-2 text-left text-sm hover:bg-neutral-900 disabled:opacity-40"><span className="min-w-0 flex-1 truncate">{item.title}</span><span>{dependencyIds.includes(item.id) ? "✓" : ""}</span></button>)}</div><PopupFooter pending={pending} onClear={dependencyIds.length ? () => setDependencyIds([]) : undefined} onSave={() => save(() => updateWorkItemDependencies(props.workspaceSlug, props.workItemId, dependencyIds))} /></Popup> : null}</div></Field>
                        <Field label="Links" icon="relationship" className="lg:col-start-2 lg:row-start-3 lg:border-l lg:border-neutral-900 lg:pl-8">
                            <div className="relative inline-flex max-w-full flex-wrap gap-1.5">
                                <button data-work-item-popup-trigger type="button" aria-disabled={props.linksLocked} onClick={() => { if (!props.linksLocked) toggle("links") }} className={`flex max-w-full flex-wrap gap-1.5 rounded p-0 ${props.linksLocked ? "cursor-not-allowed" : "hover:opacity-90"}`}>
                                    {props.relationships.map((relationship) => <RoundPill key={`relationship-${relationship.id}`} tone="sky">{relationship.label}</RoundPill>)}
                                    {props.keyResults.map((result) => <RoundPill key={`result-${result.id}`} tone="sky">{result.code}</RoundPill>)}
                                    {!props.relationships.length && !props.keyResults.length ? <span className="text-neutral-600">None</span> : null}
                                </button>
                                {open === "links" ? <Popup className="w-[30rem] max-w-[calc(100vw-2rem)]">
                                    <Search value={query} onChange={setQuery} placeholder="Search relationships or Key Results…" />
                                    <div className="max-h-[28rem] overflow-y-auto p-1">
                                        {!props.relationshipsLocked ? <>
                                            <p className="px-1.5 pb-1 pt-2 text-[11px] font-medium uppercase tracking-wide text-neutral-600">Relationships</p>
                                            {filteredRelationships.length ? filteredRelationships.map((relationship) => <button type="button" key={relationship.id} onClick={() => toggleId(relationshipIds, relationship.id, setRelationshipIds)} className="flex w-full gap-2 rounded-lg px-1.5 py-2 text-left text-sm hover:bg-neutral-900"><span className="min-w-0 flex-1 truncate">{relationship.label}</span><span>{relationshipIds.includes(relationship.id) ? "✓" : ""}</span></button>) : <p className="px-1.5 py-2 text-xs text-neutral-600">No relationships found.</p>}
                                        </> : null}
                                        <p className="px-1.5 pb-1 pt-3 text-[11px] font-medium uppercase tracking-wide text-neutral-600">Committed Key Results</p>
                                        {filteredKeyResults.length ? filteredKeyResults.map((result) => {
                                            const estimate = keyResultEstimates.find((link) => link.keyResultId === result.id)
                                            const unitLabel = result.unit === "percentage" ? "percentage points" : result.unit === "currency" ? (result.currency_code ?? "USD").toUpperCase() : result.unit === "duration" ? "hours" : "units"
                                            return <div key={result.id} className={`rounded-lg ${estimate ? "border border-neutral-800 bg-neutral-950" : ""}`}>
                                                <button type="button" onClick={() => toggleKeyResult(result.id)} className="flex w-full items-start gap-3 rounded-lg px-1.5 py-2 text-left hover:bg-neutral-900">
                                                    <RoundPill tone="sky">{result.code}</RoundPill>
                                                    <span className="min-w-0 flex-1"><span className="block truncate text-sm text-white">{result.name}</span><span className="block truncate text-xs text-neutral-600">{result.objective}</span></span>
                                                    <span className="text-sm">{estimate ? "✓" : ""}</span>
                                                </button>
                                                {estimate ? <div className="grid gap-2 border-t border-neutral-800 px-2.5 py-2.5">
                                                    <label className="text-xs text-neutral-400">Expected movement <span className="text-neutral-600">({unitLabel})</span><input type="number" min="0.000001" step="any" required value={estimate.expectedMovement} onChange={(event) => updateKeyResultEstimate(result.id, { expectedMovement: event.target.value })} className="mt-1 h-9 w-full rounded-md border border-neutral-700 bg-black px-2.5 text-sm text-white outline-none focus:border-neutral-500" /></label>
                                                    <label className="text-xs text-neutral-400">Impact hypothesis<textarea rows={2} required value={estimate.impactHypothesis} onChange={(event) => updateKeyResultEstimate(result.id, { impactHypothesis: event.target.value })} placeholder="Why should this work move the KR?" className="mt-1 w-full rounded-md border border-neutral-700 bg-black px-2.5 py-2 text-sm text-white outline-none focus:border-neutral-500" /></label>
                                                </div> : null}
                                            </div>
                                        }) : <p className="px-1.5 py-2 text-xs text-neutral-600">No committed Key Results found.</p>}
                                    </div>
                                    {error ? <p className="border-t border-red-500/20 px-2.5 py-2 text-xs text-red-300">{error}</p> : null}
                                    <PopupFooter pending={pending} onClear={relationshipIds.length || keyResultEstimates.length ? () => { setRelationshipIds([]); setKeyResultEstimates([]) } : undefined} onSave={saveLinks} />
                                </Popup> : null}
                            </div>
                        </Field>
                        <Field label="Priority" icon="priority" className="lg:col-start-2 lg:row-start-4 lg:border-l lg:border-neutral-900 lg:pl-8"><div className="relative inline-block"><button data-work-item-popup-trigger type="button" onClick={() => toggle("priority")} className="rounded py-0.5 text-left hover:text-white">{workItemPrioritySelectionLabel(props.priorityOverride)}</button>{open === "priority" ? <Popup className="w-72"><div className="p-1">{workItemPrioritySelectionOptions.map((option) => { const value = option.value === "system" ? null : Number(option.value); return <button type="button" key={option.value} onClick={() => save(() => updateWorkItemPriority(props.workspaceSlug, props.workItemId, value))} className="flex w-full items-center justify-between rounded-lg px-1.5 py-2 text-left text-sm hover:bg-neutral-900"><span>{option.label}</span><span>{props.priorityOverride === value ? "✓" : ""}</span></button> })}</div><p className="border-t border-neutral-800 px-2.5 py-2 text-xs leading-5 text-neutral-600">System generated lets the queue decide from deadlines, dependencies, duration, and expected KR movement. Choose another option only to override that result.</p></Popup> : null}</div></Field>
                    </div>
                    <Field label="Description" icon="description" className="lg:col-span-2 lg:col-start-1 lg:row-start-5">
                        <div>
                            <textarea ref={descriptionRef} value={description} onChange={(event) => setDescription(event.target.value)} rows={3} placeholder="Add a description…" className="min-h-20 w-full resize-none overflow-hidden bg-transparent py-0 text-sm leading-6 text-neutral-200 caret-neutral-300 outline-none placeholder:text-neutral-600 selection:bg-neutral-600 selection:text-white" />
                            {description !== (props.description ?? "") ? <div className="mt-1 flex justify-end gap-1.5"><button type="button" disabled={pending} onClick={() => setDescription(props.description ?? "")} className="h-8 px-2 text-xs text-neutral-400 hover:text-white disabled:opacity-50">Cancel</button><button type="button" disabled={pending} onClick={() => save(() => updateWorkItemDescription(props.workspaceSlug, props.workItemId, description))} className="h-8 rounded-md bg-white px-3 text-xs font-medium text-black disabled:opacity-50">{pending ? "Saving…" : "Save"}</button></div> : null}
                        </div>
                    </Field>
                </div>
                {error ? <p className="border-t border-red-500/20 py-2 text-sm text-red-300">{error}</p> : null}
            </section>
        </div>
    )
}
