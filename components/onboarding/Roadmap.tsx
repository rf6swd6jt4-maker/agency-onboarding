"use client"

import { useEffect, useRef } from "react"
import type { Ref } from "react"
import Link from "next/link"

type RoadmapStep = {
    key: string
    title: string
    complete: boolean
    current: boolean
    href?: string | null
}

type RoadmapProps = {
    steps: RoadmapStep[]
    onSelect?: (stepKey: string) => void
    allowAllSteps?: boolean
}

export function Roadmap({ steps, onSelect, allowAllSteps = false }: RoadmapProps) {
    const currentStepRef = useRef<HTMLElement>(null)

    useEffect(() => {
        currentStepRef.current?.scrollIntoView({
            block: "center",
            behavior: "smooth",
        })
    }, [steps])

    return (
        <aside className="flex max-h-full min-h-0 flex-col rounded-2xl border border-black/10 bg-[var(--onboarding-surface,#FFFFFF)] p-5">
            <p className="text-xs font-semibold uppercase tracking-wide text-[var(--onboarding-muted,#475569)]">
                Project setup
            </p>

            <div className="mt-5 min-h-0 flex-1 space-y-3 overflow-hidden">
                {steps.map((step) => {
                    const className = `flex items-center gap-3 rounded-xl px-3 py-2 text-sm ${
                            step.current
                                ? "bg-[color-mix(in_srgb,var(--onboarding-primary,#1E3A5F)_10%,transparent)] text-[var(--onboarding-primary,#1E3A5F)]"
                                : "text-[var(--onboarding-muted,#475569)]"
                        }`
                    const content = <>
                        <span
                            className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-xs ${
                                step.complete
                                    ? "border-[var(--onboarding-primary,#1E3A5F)] bg-[var(--onboarding-primary,#1E3A5F)] text-white"
                                    : step.current
                                      ? "border-[var(--onboarding-accent,#F0B429)] bg-[var(--onboarding-accent,#F0B429)] text-[var(--onboarding-text,#0F172A)]"
                                      : "border-[color-mix(in_srgb,var(--onboarding-muted,#475569)_30%,transparent)]"
                            }`}
                        >
                            {step.complete ? "✓" : step.current ? "→" : ""}
                        </span>

                        <span className="min-w-0 break-words font-medium leading-snug">
                            {step.title}
                        </span>
                    </>
                    return onSelect && (allowAllSteps || step.complete || step.current) ? (
                        <button key={step.key} ref={step.current ? currentStepRef as Ref<HTMLButtonElement> : undefined} type="button" onClick={() => onSelect(step.key)} className={`w-full text-left ${className}`}>{content}</button>
                    ) : step.href ? (
                        <Link key={step.key} ref={step.current ? currentStepRef as Ref<HTMLAnchorElement> : undefined} href={step.href} className={className}>{content}</Link>
                    ) : (
                        <div key={step.key} ref={step.current ? currentStepRef as Ref<HTMLDivElement> : undefined} className={className}>{content}</div>
                    )
                })}
            </div>
        </aside>
    )
}
