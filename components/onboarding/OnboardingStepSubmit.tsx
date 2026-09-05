"use client"

import { useRouter } from "next/navigation"
import { type FormEvent, useState, useTransition } from "react"
import { completePreparedStep } from "@/app/onboarding/session/[token]/actions"
import { LoadingOverlay } from "@/components/LoadingOverlay"
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
    const [pending, startTransition] = useTransition()
    const [error, setError] = useState<string | null>(null)

    function submit(event: FormEvent<HTMLFormElement>) {
        event.preventDefault()
        setError(null)
        startTransition(() => {
            void completePreparedStep(token, stepKey).then((outcome) => {
                if (!outcome.ok) {
                    setError(outcome.error)
                    return
                }
                if (outcome.clientPortalUrl) {
                    window.location.assign(outcome.clientPortalUrl)
                    return
                }
                router.push(outcome.nextPath)
                router.refresh()
            }).catch(() => setError("Could not complete this onboarding step."))
        })
    }

    return <form onSubmit={submit} data-global-loading="false" className="contents">
        {pending ? <LoadingOverlay label="Saving your progress..." /> : null}
        <button type="submit" disabled={pending} className="w-full rounded-xl bg-[var(--onboarding-primary,#1E3A5F)] px-5 py-4 font-medium text-white transition active:scale-[0.99] active:opacity-80 disabled:cursor-wait disabled:opacity-60">
            {pending ? (label.toLowerCase().includes("finish") ? "Finishing onboarding…" : "Saving…") : label}
        </button>
        {error ? <p role="alert" className="col-span-full text-left text-sm text-red-700">{error} <RequestHelpLink />.</p> : null}
    </form>
}
