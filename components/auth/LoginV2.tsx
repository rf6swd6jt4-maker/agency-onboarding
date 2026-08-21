"use client"

import Link from "next/link"
import { Suspense, useEffect, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { AuthFieldFeedback } from "@/components/auth/AuthFieldFeedback"
import { AuthFlowShell, authInput, authPrimaryButton } from "@/components/auth/AuthFlowShell"
import { PasswordField } from "@/components/auth/PasswordField"
import { normalizeAuthNext, resolveClientDestination } from "@/lib/auth/redirects"
import { createSupabaseBrowserClient } from "@/lib/supabase/browser"

const PASSWORD_RESET_EVENT = "betelgeze-password-reset-complete"

function LoginForm() {
    const router = useRouter()
    const searchParams = useSearchParams()
    const [error, setError] = useState<string | null>(null)
    const [notice, setNotice] = useState<string | null>(searchParams.get("passwordReset") === "1" ? "Password changed. Sign in with your new password." : searchParams.get("emailConfirmed") === "1" ? "Email confirmed. Sign in to continue." : null)
    const [loading, setLoading] = useState(false)
    const [identifier, setIdentifier] = useState(searchParams.get("email") ?? "")
    const [password, setPassword] = useState("")
    const next = searchParams.get("next")
    const loggedOut = searchParams.get("loggedOut") === "1"

    useEffect(() => {
        let cancelled = false
        void createSupabaseBrowserClient().auth.getUser().then(({ data }) => {
            if (cancelled || !data.user) return
            window.location.replace(`/mfa?next=${encodeURIComponent(resolveClientDestination(next))}`)
        })
        return () => { cancelled = true }
    }, [next])

    useEffect(() => {
        const receiveReset = () => { setPassword(""); setError(null); setNotice("Password changed. Sign in with your new password.") }
        const channel = typeof BroadcastChannel !== "undefined" ? new BroadcastChannel("betelgeze-account-security") : null
        channel?.addEventListener("message", (event) => { if (event.data?.type === "password-reset-complete") receiveReset() })
        const storage = (event: StorageEvent) => { if (event.key === PASSWORD_RESET_EVENT) receiveReset() }
        window.addEventListener("storage", storage)
        const focus = () => { const stamp = Number(localStorage.getItem(PASSWORD_RESET_EVENT) ?? 0); if (stamp && Date.now() - stamp < 10 * 60 * 1000) receiveReset() }
        window.addEventListener("focus", focus)
        return () => { channel?.close(); window.removeEventListener("storage", storage); window.removeEventListener("focus", focus) }
    }, [])

    async function submit(event: React.FormEvent<HTMLFormElement>) {
        event.preventDefault(); setLoading(true); setError(null); setNotice(null)
        const response = await fetch("/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ identifier, password }) })
        const result = await response.json().catch(() => ({}))
        if (!response.ok) {
            if (result.code === "email_unconfirmed") {
                setError("Confirm your email from the newest invitation message. Ask a workspace administrator to resend the invitation if it has expired.")
                setLoading(false)
                return
            }
            setError(result.error ?? "That email, username, or password did not match."); setLoading(false); return
        }
        const destination = next ? normalizeAuthNext(next, window.location.origin) : window.location.origin
        router.replace(`/mfa?next=${encodeURIComponent(destination)}`); router.refresh()
    }

    return <AuthFlowShell showProgress={false} eyebrow="Betelgeze account" title="Welcome back" description="Sign in with your email or username. We’ll ask for your authenticator before opening the app." footer={<>Need an account? Open the invitation sent by your workspace administrator.</>}>
        <form onSubmit={submit} autoComplete="on">
            <label htmlFor="login-identifier" className="text-sm font-medium text-neutral-200">Username or email</label>
            <input id="login-identifier" value={identifier} onChange={(event) => setIdentifier(event.target.value)} name="username" type="text" inputMode="email" autoComplete="username" autoCapitalize="none" autoCorrect="off" spellCheck={false} enterKeyHint="next" required className={authInput} />
            <div className="mt-5"><PasswordField value={password} onChange={setPassword} label="Password" autoComplete="current-password" showRequirements={false} disabled={loading} /></div>
            <div className="mt-3 text-right"><Link className="text-sm text-neutral-300 underline decoration-neutral-700 underline-offset-4 hover:text-white" href={`/forgot-password${identifier.includes("@") ? `?email=${encodeURIComponent(identifier)}` : ""}`}>Forgot password?</Link></div>
            {loggedOut ? <AuthFieldFeedback tone="green" message="You’re signed out on this device." /> : null}
            {notice ? <AuthFieldFeedback tone="green" message={notice} /> : null}
            {error ? <AuthFieldFeedback tone="red" message={error} /> : null}
            <button disabled={loading || !identifier || !password} className={`${authPrimaryButton} mt-6`}>{loading ? "Signing in…" : "Sign in"}</button>
        </form>
    </AuthFlowShell>
}

export function LoginV2() { return <Suspense fallback={null}><LoginForm /></Suspense> }
