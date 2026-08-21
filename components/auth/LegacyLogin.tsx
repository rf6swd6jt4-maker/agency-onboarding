"use client"

import Link from "next/link"
import { Suspense, useEffect, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { BrandLockup } from "@/components/brand/BrandLockup"
import { normalizeAuthNext, resolveClientDestination } from "@/lib/auth/redirects"
import { createSupabaseBrowserClient } from "@/lib/supabase/browser"

function LegacyLoginForm() {
    const router = useRouter()
    const searchParams = useSearchParams()
    const [error, setError] = useState<string | null>(null)
    const [loading, setLoading] = useState(false)
    const [identifier, setIdentifier] = useState(searchParams.get("email") ?? "")
    const invite = searchParams.get("invite")
    const next = searchParams.get("next")
    const loggedOut = searchParams.get("loggedOut") === "1"
    const inviteDestination = invite ? `/invites/accept?token=${invite}` : null

    useEffect(() => {
        let cancelled = false
        void createSupabaseBrowserClient().auth.getUser().then(({ data }) => {
            if (cancelled || !data.user) return
            const destination = next ? resolveClientDestination(next) : inviteDestination ? resolveClientDestination(inviteDestination) : resolveClientDestination(null)
            window.location.replace(destination)
        })
        return () => { cancelled = true }
    }, [inviteDestination, next])

    async function submit(event: React.FormEvent<HTMLFormElement>) {
        event.preventDefault(); setLoading(true); setError(null)
        const values = new FormData(event.currentTarget)
        const submittedIdentifier = String(values.get("username") ?? values.get("identifier") ?? "")
        const response = await fetch("/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ identifier: submittedIdentifier, password: String(values.get("password") ?? "") }) })
        const result = await response.json().catch(() => ({}))
        if (!response.ok) {
            if (result.code === "email_unconfirmed") { window.location.assign(`/check-email?email=${encodeURIComponent(result.email ?? submittedIdentifier)}`); return }
            setError(result.error ?? "Invalid login credentials."); setLoading(false); return
        }
        const destination = next ? normalizeAuthNext(next, window.location.origin) : inviteDestination ?? window.location.origin
        router.replace(`/mfa?next=${encodeURIComponent(destination)}`); router.refresh()
    }

    return <main className="flex min-h-screen items-center justify-center bg-neutral-950 px-6 text-white"><form onSubmit={submit} autoComplete="on" className="w-full max-w-sm rounded-2xl border border-neutral-800 bg-neutral-900 p-7"><BrandLockup compact /><h1 className="mt-5 text-2xl font-semibold">Log in to your dashboard</h1>{loggedOut && <p className="mt-4 text-sm text-emerald-300">You’re signed out on this device. Your other devices remain signed in.</p>}<label className="mt-6 block text-sm" htmlFor="login-identifier">Username or email<input id="login-identifier" value={identifier} onChange={(event) => setIdentifier(event.target.value)} name="username" type="text" inputMode="email" autoComplete="username" autoCapitalize="none" autoCorrect="off" spellCheck={false} enterKeyHint="next" required className="mt-2 w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-3" /></label><label className="mt-4 block text-sm" htmlFor="login-password">Password<input id="login-password" name="password" type="password" autoComplete="current-password" autoCapitalize="none" autoCorrect="off" spellCheck={false} enterKeyHint="go" required className="mt-2 w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-3" /></label><div className="mt-3 text-right"><Link className="text-sm text-neutral-300 underline" href="/forgot-password">Forgot password?</Link></div>{error && <p className="mt-4 text-sm text-red-400">{error}</p>}<button disabled={loading} className="mt-6 w-full rounded-lg bg-white px-4 py-3 font-medium text-black disabled:opacity-50">{loading ? "Logging in…" : "Log in"}</button><p className="mt-5 text-sm text-neutral-400">New here? <Link className="text-white underline" href="https://betelgeze.com/sign-up">Sign up</Link></p></form></main>
}

export function LegacyLogin() { return <Suspense fallback={null}><LegacyLoginForm /></Suspense> }
