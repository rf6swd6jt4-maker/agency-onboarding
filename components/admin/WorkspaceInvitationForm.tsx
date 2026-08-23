"use client"

import { useActionState, useEffect, useRef } from "react"
import type { WorkspaceInvitationActionState } from "@/app/[workspaceSlug]/users/actions"
import { WorkspaceActionButton } from "@/components/workspace/WorkspaceActionButton"

export function WorkspaceInvitationForm({
    action,
    canInviteAdmins,
}: {
    action: (state: WorkspaceInvitationActionState, formData: FormData) => Promise<WorkspaceInvitationActionState>
    canInviteAdmins: boolean
}) {
    const [state, formAction] = useActionState(action, {})
    const formRef = useRef<HTMLFormElement>(null)

    useEffect(() => {
        if (state.ok) formRef.current?.reset()
    }, [state])

    return (
        <form ref={formRef} action={formAction} data-global-loading="false" data-workspace-mutation="background" className="grid min-w-0 max-w-full gap-3 rounded-2xl border border-neutral-800 bg-neutral-900 p-4 sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:p-5">
            <input name="email" type="email" required placeholder="person@business.com" className="min-w-0 w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2" />
            <select name="role" defaultValue="staff" className="min-w-0 w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2">
                <option value="staff">Staff</option>
                {canInviteAdmins ? <option value="admin">Admin</option> : null}
            </select>
            <WorkspaceActionButton pendingLabel="Inviting…" className="rounded-lg bg-white px-4 py-2 font-medium text-black">Invite user</WorkspaceActionButton>
            {state.message ? (
                <p className={`text-sm sm:col-span-3 ${state.ok ? "text-emerald-300" : "text-red-300"}`} role={state.ok ? "status" : "alert"} aria-live="polite">
                    {state.message}
                </p>
            ) : null}
        </form>
    )
}
