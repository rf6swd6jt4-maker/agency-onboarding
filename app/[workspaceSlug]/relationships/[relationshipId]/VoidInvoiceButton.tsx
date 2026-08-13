"use client"

import { useState, useTransition } from "react"

export function VoidInvoiceButton({
    referenceId,
    kind = "one_off",
    alreadyVoided = false,
    action,
}: {
    referenceId: string
    kind?: "one_off" | "recurring"
    alreadyVoided?: boolean
    action: () => Promise<{ ok: boolean; error?: string }>
}) {
    const [pending, startTransition] = useTransition()
    const [error, setError] = useState<string | null>(null)

    function run() {
        const recurring = kind === "recurring"
        if (!window.confirm(alreadyVoided
            ? `Finish reopening this deal for a replacement of ${recurring ? "expired recurring Checkout page" : "voided Stripe invoice"} ${referenceId}? The frozen snapshot will remain in Activity.`
            : `${recurring ? "Expire recurring Stripe Checkout page" : "Void Stripe invoice"} ${referenceId} and reopen this deal for a replacement? The frozen snapshot will remain in Activity.`)) return
        setError(null)
        startTransition(async () => {
            const result = await action()
            if (!result.ok) setError(result.error ?? "The invoice could not be voided.")
        })
    }

    return <div>
        <button type="button" disabled={pending} onClick={run} className="inline-flex min-h-9 items-center rounded-lg border border-amber-500/40 px-3 text-xs font-medium text-amber-100 hover:bg-amber-950/30 disabled:opacity-50">
            {pending ? "Updating…" : alreadyVoided ? "Finish preparing replacement" : kind === "recurring" ? "Expire and prepare replacement" : "Void and prepare replacement"}
        </button>
        {error ? <p role="alert" className="mt-2 text-xs text-red-200">{error}</p> : null}
    </div>
}
