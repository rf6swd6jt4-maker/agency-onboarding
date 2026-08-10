"use client"

import Link from "next/link"
import { FormEvent, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { FormPendingOverlay } from "@/components/FormPendingOverlay"

type TestClientMenuProps = {
    currentStepTitle: string
    previousStepHref?: string | null
    skipAction: () => Promise<{ ok: true; nextPath: string } | { ok: false; error: string }>
}

export function TestClientMenu({
    currentStepTitle,
    previousStepHref,
    skipAction,
}: TestClientMenuProps) {
    const router = useRouter()
    const [pending, startTransition] = useTransition()
    const [error, setError] = useState<string | null>(null)

    function skip(event: FormEvent<HTMLFormElement>) {
        event.preventDefault()
        setError(null)
        startTransition(() => {
            void skipAction().then((outcome) => {
                if (!outcome.ok) {
                    setError(outcome.error)
                    return
                }
                router.push(outcome.nextPath)
                router.refresh()
            }).catch(() => setError("Could not skip this test step."))
        })
    }

    return (
        <details className="relative">
            <summary className="flex h-10 cursor-pointer list-none items-center rounded-full border border-amber-200 bg-amber-50 px-3 text-sm font-semibold text-amber-950 transition hover:border-amber-400">
                Test menu
            </summary>

            <div className="absolute right-0 top-12 z-40 w-72 rounded-2xl border border-black/10 bg-[var(--onboarding-surface,#FFFFFF)] p-4 text-left shadow-xl">
                <p className="text-xs font-semibold uppercase tracking-wide text-amber-700">
                    Test client
                </p>

                <p className="mt-2 text-sm text-[var(--onboarding-muted,#475569)]">
                    Current step:{" "}
                    <span className="font-semibold text-[var(--onboarding-text,#0F172A)]">
                        {currentStepTitle}
                    </span>
                </p>

                <form onSubmit={skip} className="mt-4">
                    {pending ? <FormPendingOverlay /> : null}

                    <button disabled={pending} className="w-full rounded-lg bg-[var(--onboarding-primary,#1E3A5F)] px-3 py-2 text-sm font-semibold text-white disabled:opacity-60">
                        Skip this step
                    </button>
                </form>

                {error ? <p role="status" className="mt-3 text-sm text-red-700">{error}</p> : null}

                {previousStepHref ? (
                    <Link
                        href={previousStepHref}
                        className="mt-3 block rounded-lg border border-black/10 px-3 py-2 text-center text-sm font-semibold text-[var(--onboarding-primary,#1E3A5F)]"
                    >
                        Previous step
                    </Link>
                ) : (
                    <p className="mt-3 rounded-lg bg-[var(--onboarding-page,#F8F7F3)] px-3 py-2 text-center text-sm text-[var(--onboarding-muted,#475569)] opacity-70">
                        No previous step
                    </p>
                )}
            </div>
        </details>
    )
}
