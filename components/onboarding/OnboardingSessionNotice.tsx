"use client"

import { useEffect } from "react"
import { markSessionNoticeSeen } from "@/app/onboarding/session/[token]/actions"

type OnboardingSessionNoticeProps = {
    token: string
    noticeId: string
    explanation: string
    requiresCompletion: boolean
    sections?: string[]
}

export function OnboardingSessionNotice({ token, noticeId, explanation, requiresCompletion, sections = [] }: OnboardingSessionNoticeProps) {
    useEffect(() => {
        void markSessionNoticeSeen(token, noticeId)
    }, [noticeId, token])

    return (
        <div className="mt-6 rounded-2xl border border-[color-mix(in_srgb,var(--onboarding-accent,#F0B429)_55%,transparent)] bg-[color-mix(in_srgb,var(--onboarding-accent,#F0B429)_12%,var(--onboarding-surface,#FFFFFF))] p-5 text-[var(--onboarding-text,#0F172A)]">
            <p className="font-semibold">Your onboarding was updated</p>
            <p className="mt-2 text-sm leading-6 text-[var(--onboarding-muted,#475569)]">{explanation}</p>
            {sections.length ? <p className="mt-2 text-xs font-medium text-[var(--onboarding-primary,#1E3A5F)]">Affected sections: {sections.join(", ")}</p> : null}
            {requiresCompletion ? (
                <p className="mt-3 text-xs font-medium text-[var(--onboarding-primary,#1E3A5F)]">
                    Please complete this updated module before continuing.
                </p>
            ) : null}
        </div>
    )
}
