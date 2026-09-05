"use client"

import { useRouter } from "next/navigation"
import { type FormEvent, useState, useTransition } from "react"
import { completePreparedStep } from "@/app/onboarding/session/[token]/actions"
import { useOnboardingSaveCoordinator } from "@/components/onboarding/OnboardingSaveCoordinator"
import { RequestHelpLink } from "@/components/onboarding/RequestHelpLink"

export function OnboardingStepSubmit({
    token,
    stepKey,
    label,
}: {
    token: string
    stepKey: string
    label: string
}) {
    const router = useRouter()
    const { flushAll } = useOnboardingSaveCoordinator()
    const [pending, startTransition] = useTransition()
    const [error, setError] = useState<string | null>(null)

    function submit(event: FormEvent<HTMLFormElement>) {
        event.preventDefault()
        setError(null)
        startTransition(() => {
            void (async () => {
                try {
                    await flushAll()
                    const outcome = await completePreparedStep(token, stepKey)
                    if (!outcome.ok) {
                        setError(outcome.error)
                        return
                    }
                    if (outcome.clientPortalUrl) {
                        window.location.assign(outcome.clientPortalUrl)
                        return
                    }
                    router.replace(outcome.nextPath)
                } catch (caughtError) {
                    setError(caughtError instanceof Error
                        ? caughtError.message
                        : "Could not complete this onboarding step.")
                }
            })()
        })
    }

    return <form onSubmit={submit} data-global-loading="false" className="contents">
        <button type="submit" disabled={pending} className="min-h-14 w-full rounded-xl bg-[var(--onboarding-primary,#1E3A5F)] px-5 py-4 font-medium leading-6 text-white transition active:scale-[0.99] active:opacity-80 disabled:cursor-wait disabled:opacity-60">
            {pending ? (label.toLowerCase().includes("finish") ? "Finishing onboarding…" : "Saving…") : label}
        </button>
        {error ? <p role="alert" className="col-span-full text-left text-sm text-red-700">{error} <RequestHelpLink />.</p> : null}
    </form>
}
