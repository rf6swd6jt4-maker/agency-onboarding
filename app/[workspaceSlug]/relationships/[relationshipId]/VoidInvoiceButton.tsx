"use client"

import { useState, useTransition } from "react"

export function VoidInvoiceButton({
    invoiceId,
    alreadyVoided = false,
    action,
}: {
    invoiceId: string
    alreadyVoided?: boolean
    action: () => Promise<{ ok: boolean; error?: string }>
}) {
    const [pending, startTransition] = useTransition()
    const [error, setError] = useState<string | null>(null)

    function run() {
        if (!window.confirm(alreadyVoided
            ? `Finish reopening this deal for a replacement of voided Stripe invoice ${invoiceId}? The frozen invoice snapshot will remain in Activity.`
            : `Void Stripe invoice ${invoiceId} and reopen this deal for a replacement invoice? The frozen invoice snapshot will remain in Activity.`)) return
        setError(null)
        startTransition(async () => {
            const result = await action()
            if (!result.ok) setError(result.error ?? "The invoice could not be voided.")
        })
    }

    return <div>
        <button type="button" disabled={pending} onClick={run} className="inline-flex min-h-9 items-center rounded-lg border border-amber-500/40 px-3 text-xs font-medium text-amber-100 hover:bg-amber-950/30 disabled:opacity-50">
            {pending ? "Updating…" : alreadyVoided ? "Finish preparing replacement" : "Void and prepare replacement"}
        </button>
        {error ? <p role="alert" className="mt-2 text-xs text-red-200">{error}</p> : null}
    </div>
}
