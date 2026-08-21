"use client"

import { useActionState, useEffect, useState } from "react"
import { createPortal } from "react-dom"
import { AuthFieldFeedback } from "@/components/auth/AuthFieldFeedback"
import { Status } from "@/components/ui"

type ResetResult = { ok: boolean; message: string }

export function AdminMfaResetButton({ email, userId, action }: { email: string; userId: string; action: (formData: FormData) => Promise<ResetResult> }) {
    const [open, setOpen] = useState(false)
    const [confirmation, setConfirmation] = useState("")
    const expected = `RESET ${email}`
    const [result, formAction, pending] = useActionState(async (_state: ResetResult | null, formData: FormData) => {
        try {
            const nextResult = await action(formData)
            if (nextResult.ok) {
                setOpen(false)
                setConfirmation("")
            }
            return nextResult
        } catch {
            return { ok: false, message: "The reset request was interrupted. No successful reset was confirmed; check the account before retrying." }
        }
    }, null)
    useEffect(() => {
        if (!open) return
        const escape = (event: KeyboardEvent) => { if (event.key === "Escape" && !pending) setOpen(false) }
        document.addEventListener("keydown", escape)
        return () => document.removeEventListener("keydown", escape)
    }, [open, pending])

    const feedback = confirmation === expected
        ? { tone: "green" as const, message: "Confirmation matches. The reset is ready." }
        : confirmation.length >= expected.length
            ? { tone: "red" as const, message: `Type ${expected} exactly.` }
            : { tone: confirmation ? "yellow" as const : "grey" as const, message: `Type ${expected} to authorize this security reset.` }

    return <>
        <button type="button" onClick={() => { setConfirmation(""); setOpen(true) }} className="rounded-lg border border-yellow-900 px-3 py-1 text-sm text-yellow-200 hover:bg-yellow-950/30">Reset 2FA</button>
        {open && typeof document !== "undefined" ? createPortal(
            <div className="fixed inset-0 z-[180] flex items-center justify-center bg-black/75 px-4 py-6 backdrop-blur-sm" onMouseDown={(event) => { if (event.target === event.currentTarget && !pending) setOpen(false) }}>
                <section role="dialog" aria-modal="true" aria-labelledby={`mfa-reset-${userId}`} className="w-full max-w-md rounded-2xl border border-neutral-700 bg-neutral-950 p-5 text-white shadow-2xl">
                    <Status label="High-impact security action" tone="yellow" />
                    <h2 id={`mfa-reset-${userId}`} className="mt-4 text-xl font-semibold">Reset this account’s 2FA?</h2>
                    <p className="mt-3 text-sm leading-6 text-neutral-300">Every authenticator for <span className="font-medium text-white">{email}</span> will be removed. Their active sessions will end, a security notice will be sent, and authenticator setup will be required at the next login.</p>
                    <form action={formAction} className="mt-5">
                        <input type="hidden" name="userId" value={userId} />
                        <label htmlFor={`mfa-reset-confirmation-${userId}`} className="text-sm font-medium text-neutral-200">Confirmation phrase</label>
                        <input id={`mfa-reset-confirmation-${userId}`} name="confirmation" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} autoComplete="off" autoCapitalize="characters" spellCheck={false} autoFocus className="mt-2 min-h-11 w-full rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2.5 text-base text-white outline-none focus:border-neutral-400 focus:ring-2 focus:ring-white/10" />
                        <AuthFieldFeedback tone={feedback.tone} message={feedback.message} />
                        {result && !result.ok && confirmation === expected ? <AuthFieldFeedback tone="red" message={result.message} /> : null}
                        <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                            <button type="button" disabled={pending} onClick={() => setOpen(false)} className="min-h-11 rounded-lg border border-neutral-700 px-4 py-2.5 text-sm font-medium hover:border-neutral-500 disabled:opacity-50">Cancel</button>
                            <button disabled={pending || confirmation !== expected} className="min-h-11 rounded-lg bg-red-100 px-4 py-2.5 text-sm font-semibold text-red-950 disabled:cursor-not-allowed disabled:opacity-40">{pending ? "Resetting…" : "Reset authenticators"}</button>
                        </div>
                    </form>
                </section>
            </div>, document.body
        ) : null}
    </>
}
