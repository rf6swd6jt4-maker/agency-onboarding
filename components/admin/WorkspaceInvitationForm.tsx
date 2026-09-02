"use client"

import { useActionState, useEffect, useRef, useState } from "react"
import type { WorkspaceInvitationActionState } from "@/app/[workspaceSlug]/users/actions"
import { WorkspaceActionButton } from "@/components/workspace/WorkspaceActionButton"

export function WorkspaceInvitationForm({
    action,
    canInviteAdmins,
    services,
}: {
    action: (state: WorkspaceInvitationActionState, formData: FormData) => Promise<WorkspaceInvitationActionState>
    canInviteAdmins: boolean
    services: Array<{ id: string; name: string }>
}) {
    const [state, formAction] = useActionState(action, {})
    const formRef = useRef<HTMLFormElement>(null)
    const [role, setRole] = useState<"staff" | "admin">("staff")
    const [selectedServiceIds, setSelectedServiceIds] = useState<Set<string>>(() => new Set())

    useEffect(() => {
        if (!state.ok) return
        formRef.current?.reset()
        const resetRole = window.setTimeout(() => {
            setRole("staff")
            setSelectedServiceIds(new Set())
        }, 0)
        return () => window.clearTimeout(resetRole)
    }, [state])

    return (
        <form ref={formRef} action={formAction} data-global-loading="false" data-workspace-mutation="background" className="grid min-w-0 max-w-full gap-3 rounded-2xl border border-neutral-800 bg-neutral-900 p-4 sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:p-5">
            <input name="email" type="email" required placeholder="person@business.com" className="min-w-0 w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2" />
            <select name="role" value={role} onChange={(event) => setRole(event.target.value === "admin" ? "admin" : "staff")} className="min-w-0 w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2">
                <option value="staff">Staff</option>
                {canInviteAdmins ? <option value="admin">Admin</option> : null}
            </select>
            <WorkspaceActionButton pendingLabel="Inviting…" disabled={role === "staff" && selectedServiceIds.size === 0} className="rounded-lg bg-white px-4 py-2 font-medium text-black disabled:opacity-40">Invite user</WorkspaceActionButton>
            {role === "staff" ? <fieldset className="min-w-0 sm:col-span-3">
                <legend className="text-sm font-medium text-neutral-300">Service access</legend>
                <p className="mt-1 text-xs leading-5 text-neutral-500">The Staff member will only see panels and client work enabled by these services.</p>
                <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                    {services.map((service) => <label key={service.id} className="flex min-h-10 items-center gap-2 rounded-lg border border-neutral-800 bg-neutral-950 px-3 text-sm text-neutral-300">
                        <input type="checkbox" name="serviceId" value={service.id} checked={selectedServiceIds.has(service.id)} onChange={(event) => setSelectedServiceIds((current) => {
                            const next = new Set(current)
                            if (event.target.checked) next.add(service.id)
                            else next.delete(service.id)
                            return next
                        })} className="h-4 w-4 accent-white" />
                        <span className="min-w-0 truncate">{service.name}</span>
                    </label>)}
                </div>
                {!services.length ? <p className="mt-2 text-sm text-amber-300">Add an active service before inviting Staff.</p> : null}
            </fieldset> : null}
            {state.message ? (
                <p className={`text-sm sm:col-span-3 ${state.ok ? "text-emerald-300" : "text-red-300"}`} role={state.ok ? "status" : "alert"} aria-live="polite">
                    {state.message}
                </p>
            ) : null}
        </form>
    )
}
