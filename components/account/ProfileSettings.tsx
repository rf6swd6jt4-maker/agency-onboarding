"use client"

import { useActionState, useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { createSupabaseRecoveryClient } from "@/lib/supabase/recovery"

type State = { error?: string; username?: string; displayName?: string }
type Props = { username: string; displayName: string; email: string; action: (state: State, formData: FormData) => Promise<State> }

export function ProfileSettings({ username, displayName, email, action }: Props) {
    const router = useRouter()
    const [state, formAction, pending] = useActionState(action, {})
    const [passwordState, setPasswordState] = useState<"idle" | "sending" | "sent" | "error">("idle")

    useEffect(() => {
        if (state.username && state.username !== username) { router.replace(`/users/${state.username}`); router.refresh() }
        else if (state.displayName && state.displayName !== displayName) router.refresh()
    }, [displayName, router, state.displayName, state.username, username])

    async function resetPassword() {
        setPasswordState("sending")
        const supabase = createSupabaseRecoveryClient()
        const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: `${window.location.origin}/update-password` })
        setPasswordState(error ? "error" : "sent")
    }

    return <section className="mt-8 rounded-xl border border-neutral-800 bg-neutral-900 p-5"><h2 className="text-xl font-semibold">Profile</h2><p className="mt-1 text-sm text-neutral-400">Your display name identifies you in client chats. It does not need to be unique.</p><form action={formAction} className="mt-5 max-w-md"><label className="block text-sm text-neutral-300">Display name<input name="displayName" defaultValue={displayName} minLength={1} maxLength={50} required className="mt-2 w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-3 text-white" /></label><p className="mt-2 text-xs text-neutral-500">Shown to clients as ~ {displayName || "Your name"}.</p><label className="mt-5 block text-sm text-neutral-300">Username<input name="username" defaultValue={username} minLength={3} maxLength={30} pattern="[a-z0-9][a-z0-9-]{1,28}[a-z0-9]" required className="mt-2 w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-3 text-white" /></label><p className="mt-2 text-xs text-neutral-500">Used in your Betelgeze account address and must be unique.</p>{state.error && <p className="mt-3 text-sm text-red-300">{state.error}</p>}{state.username === username && state.displayName === displayName && <p className="mt-3 text-sm text-emerald-300">Profile saved.</p>}<button disabled={pending} className="mt-4 rounded-lg bg-white px-4 py-2 text-sm font-medium text-black disabled:opacity-50">{pending ? "Saving…" : "Save profile"}</button></form><div className="mt-7 border-t border-neutral-800 pt-5"><h3 className="font-medium">Password</h3><p className="mt-1 text-sm text-neutral-400">Send a reset link to {email}.</p><button type="button" onClick={resetPassword} disabled={passwordState === "sending" || passwordState === "sent"} className="mt-3 rounded-lg border border-neutral-600 px-4 py-2 text-sm text-neutral-100 hover:border-neutral-400 disabled:opacity-50">{passwordState === "sending" ? "Sending…" : passwordState === "sent" ? "Reset link sent" : "Reset password"}</button>{passwordState === "error" && <p className="mt-2 text-sm text-red-300">We could not send that reset email. Please try again.</p>}</div></section>
}
