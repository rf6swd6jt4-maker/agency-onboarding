"use client"

import { useCallback, useState } from "react"
import Link from "next/link"
import { AuthFieldFeedback } from "@/components/auth/AuthFieldFeedback"
import { MfaGuide } from "@/components/auth/MfaGuide"
import { Status } from "@/components/ui"

type Factor = { id: string; friendlyName: string; createdAt: string }
type Feedback = { tone: "green" | "red" | "yellow"; message: string }

export function SecuritySettings({ email, initialFactors }: { email: string; initialFactors: Factor[] }) {
    const [factors, setFactors] = useState(initialFactors)
    const [adding, setAdding] = useState(false)
    const [removing, setRemoving] = useState(false)
    const [pendingRemoval, setPendingRemoval] = useState<Factor | null>(null)
    const [feedback, setFeedback] = useState<Feedback | null>(null)
    const refresh = useCallback(async () => {
        const response = await fetch("/api/auth/mfa", { cache: "no-store" })
        const body = await response.json() as { factors?: Factor[]; error?: string }
        if (!response.ok) {
            setFeedback({ tone: "red", message: body.error ?? "The verified authenticator list could not be refreshed." })
            return
        }
        setFactors(body.factors ?? [])
        setAdding(false)
        setFeedback({ tone: "green", message: "Backup authenticator verified." })
    }, [])
    async function removeFactor(factorId: string) {
        if (removing) return
        setRemoving(true)
        setFeedback({ tone: "yellow", message: "Removing that authenticator…" })
        try {
            const response = await fetch(`/api/auth/mfa?factorId=${encodeURIComponent(factorId)}`, { method: "DELETE" })
            const body = await response.json().catch(() => ({}))
            if (!response.ok) {
                setFeedback({ tone: "red", message: body.error ?? "The authenticator could not be removed." })
                return
            }
            setFactors((current) => current.filter((factor) => factor.id !== factorId))
            setPendingRemoval(null)
            setFeedback({ tone: "green", message: "Authenticator removed." })
        } catch {
            setFeedback({ tone: "red", message: "The authenticator could not be removed. Check your connection and try again." })
        } finally {
            setRemoving(false)
        }
    }
    return <div className="space-y-6">
        <section className="rounded-2xl border border-neutral-800 bg-neutral-900 p-5">
            <div className="flex flex-wrap items-start justify-between gap-4"><div><h2 className="text-lg font-semibold">Password</h2><p className="mt-1 text-sm text-neutral-400">Recovery messages are sent to {email}.</p></div><Status label="Configured" tone="green" /></div>
            <Link href={`/forgot-password?email=${encodeURIComponent(email)}`} className="mt-4 inline-flex min-h-10 items-center rounded-lg border border-neutral-700 px-3 py-2 text-sm hover:border-neutral-500">Change password</Link>
        </section>
        <section className="rounded-2xl border border-neutral-800 bg-neutral-900 p-5">
            <div className="flex flex-wrap items-start justify-between gap-4"><div><h2 className="text-lg font-semibold">Authenticator apps</h2><p className="mt-1 text-sm text-neutral-400">The first factor is required. A second factor gives you a safer recovery route.</p></div><Status label={`${factors.length} verified`} tone={factors.length ? "green" : "red"} /></div>
            <div className="mt-5 divide-y divide-neutral-800 rounded-xl border border-neutral-800 bg-neutral-950">
                {factors.map((factor, index) => <div key={factor.id} className="flex items-center justify-between gap-4 p-4"><div className="min-w-0"><p className="truncate text-sm font-medium">{factor.friendlyName || `Authenticator ${index + 1}`}</p><p className="mt-1 text-xs text-neutral-500">Added {new Date(factor.createdAt).toLocaleDateString()}</p></div><div className="flex items-center gap-3"><Status label={index === 0 ? "Primary" : "Backup"} tone="green" /><button type="button" onClick={() => { setPendingRemoval(factor); setFeedback(null) }} disabled={factors.length <= 1} className="text-xs text-neutral-400 underline underline-offset-4 disabled:cursor-not-allowed disabled:opacity-40">Remove</button></div></div>)}
            </div>
            {pendingRemoval ? <div role="dialog" aria-label="Confirm authenticator removal" className="betelgeze-popup-enter mt-5 rounded-xl border border-yellow-900/70 bg-yellow-950/20 p-4"><Status label="Confirmation required" tone="yellow" /><p className="mt-3 text-sm leading-6 text-neutral-200">Remove <span className="font-medium text-white">{pendingRemoval.friendlyName}</span>? Codes from it will stop working immediately. Your remaining authenticator will continue protecting the account.</p><div className="mt-4 flex flex-wrap gap-2"><button type="button" disabled={removing} onClick={() => void removeFactor(pendingRemoval.id)} className="min-h-10 rounded-lg bg-red-100 px-3 py-2 text-sm font-semibold text-red-950 disabled:opacity-50">{removing ? "Removing…" : "Remove authenticator"}</button><button type="button" disabled={removing} onClick={() => setPendingRemoval(null)} className="min-h-10 rounded-lg border border-neutral-700 px-3 py-2 text-sm disabled:opacity-50">Keep it</button></div></div> : null}
            {feedback ? <AuthFieldFeedback tone={feedback.tone} message={feedback.message} /> : null}
            {adding ? <div className="mt-6 border-t border-neutral-800 pt-6"><MfaGuide forceSetup setupLabel="Betelgeze backup" onVerified={refresh} /><button type="button" onClick={() => setAdding(false)} className="mt-4 text-sm text-neutral-400 underline underline-offset-4">Cancel</button></div> : <button type="button" onClick={() => { setAdding(true); setPendingRemoval(null); setFeedback(null) }} className="mt-5 min-h-10 rounded-lg border border-neutral-700 px-3 py-2 text-sm hover:border-neutral-500">Add backup authenticator</button>}
        </section>
    </div>
}
