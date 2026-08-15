"use client"

import { useState, useTransition } from "react"
import { runWorkspaceMutation } from "@/lib/workspace-mutations"

export function RemoveInvoiceForm({ action }: { action: () => void | Promise<void> }) {
    const [pending, startTransition] = useTransition()
    const [error, setError] = useState<string | null>(null)
    return (
        <form
            onSubmit={(event) => {
                event.preventDefault()
                if (!window.confirm("Remove this invoice from Betelgeze? This cannot be undone. The Stripe invoice and payment records will remain in Stripe.")) return
                setError(null)
                startTransition(async () => {
                    try { await runWorkspaceMutation(() => Promise.resolve(action()), { category: "billing" }) }
                    catch (cause) { setError(cause instanceof Error ? cause.message : "The invoice could not be removed.") }
                })
            }}
        >
            {error ? <p role="alert" className="mb-2 text-xs text-red-300">{error}</p> : null}
            <button disabled={pending} className="rounded-lg border border-red-900/80 px-3 py-2 text-center text-xs font-medium text-red-300 hover:bg-red-950/40 disabled:cursor-wait disabled:opacity-60">
                {pending ? "Removing…" : "Remove invoice"}
            </button>
        </form>
    )
}
