import Link from "next/link"

type MobileStepBarProps = {
    steps: {
        key: string
        title: string
        complete: boolean
        current: boolean
        href?: string | null
    }[]
    embedded?: boolean
    footerText?: string
    onSelect?: (stepKey: string) => void
}

export function MobileStepBar({ steps, embedded = false, footerText = "Progress saved automatically", onSelect }: MobileStepBarProps) {
    const currentIndex = steps.findIndex((step) => step.current)
    const safeCurrentIndex = currentIndex >= 0 ? currentIndex : 0

    const currentStep = steps[safeCurrentIndex]
    const stepNumber = safeCurrentIndex + 1

    const visibleCount = 4
    let startIndex = safeCurrentIndex

    if (startIndex > steps.length - visibleCount) {
        startIndex = Math.max(steps.length - visibleCount, 0)
    }

    const visibleSteps = steps.slice(startIndex, startIndex + visibleCount)

    const showLeftLine = startIndex > 0
    const showRightLine = startIndex + visibleSteps.length < steps.length

    return (
        <div className={`${embedded ? "absolute" : "fixed"} inset-x-0 bottom-0 z-30 border-t border-black/10 bg-[var(--onboarding-surface,#FFFFFF)] px-4 py-3 shadow-[0_-8px_30px_rgba(15,23,42,0.12)] lg:hidden`}>
            <div className="mx-auto max-w-md">
                <div className="mb-3 flex items-center justify-between gap-3">
                    <div className="min-w-0">
                        <p className="text-xs font-semibold uppercase tracking-wide text-[var(--onboarding-muted,#475569)]">
                            Current step
                        </p>

                        <p className="truncate text-sm font-semibold text-[var(--onboarding-primary,#1E3A5F)]">
                            {currentStep?.title ?? "Onboarding"}
                        </p>
                    </div>

                    <p className="shrink-0 text-sm font-medium text-[var(--onboarding-muted,#475569)]">
                        {stepNumber} of {steps.length}
                    </p>
                </div>

                <p className="mb-3 text-center text-xs font-medium text-[var(--onboarding-muted,#475569)]">
                    {footerText}
                </p>

                <div className="grid grid-cols-[0.5fr_36px_1fr_36px_1fr_36px_1fr_36px_0.25fr] items-center">
                    <div
                        className={`h-0.5 ${
                            showLeftLine ? "bg-[color-mix(in_srgb,var(--onboarding-muted,#475569)_30%,transparent)]" : "bg-transparent"
                        }`}
                    />

                    {visibleSteps.map((step, visibleIndex) => {
                        const actualIndex = startIndex + visibleIndex
                        const isLastVisible =
                            visibleIndex === visibleSteps.length - 1

                        return (
                            <div key={step.key} className="contents">
                                {onSelect && (step.complete || step.current) ? <button
                                    type="button"
                                    onClick={() => onSelect(step.key)}
                                    aria-label={`Open ${step.title}`}
                                    className={`flex h-9 w-9 items-center justify-center rounded-full border text-sm font-semibold ${
                                        step.complete
                                            ? "border-[var(--onboarding-primary,#1E3A5F)] bg-[var(--onboarding-primary,#1E3A5F)] text-white"
                                            : "border-[var(--onboarding-accent,#F0B429)] bg-[var(--onboarding-accent,#F0B429)] text-[var(--onboarding-text,#0F172A)]"
                                    }`}
                                >{step.complete ? "✓" : actualIndex + 1}</button> : step.href ? <Link
                                    href={step.href}
                                    aria-label={`Open ${step.title}`}
                                    className={`flex h-9 w-9 items-center justify-center rounded-full border text-sm font-semibold ${
                                        step.complete
                                            ? "border-[var(--onboarding-primary,#1E3A5F)] bg-[var(--onboarding-primary,#1E3A5F)] text-white"
                                            : step.current
                                              ? "border-[var(--onboarding-accent,#F0B429)] bg-[var(--onboarding-accent,#F0B429)] text-[var(--onboarding-text,#0F172A)]"
                                              : "border-black/20 bg-[var(--onboarding-surface,#FFFFFF)] text-[var(--onboarding-muted,#475569)]"
                                    }`}
                                >
                                    {step.complete ? "✓" : actualIndex + 1}
                                </Link> : <div
                                    className={`flex h-9 w-9 items-center justify-center rounded-full border text-sm font-semibold ${
                                        step.complete
                                            ? "border-[var(--onboarding-primary,#1E3A5F)] bg-[var(--onboarding-primary,#1E3A5F)] text-white"
                                            : step.current
                                              ? "border-[var(--onboarding-accent,#F0B429)] bg-[var(--onboarding-accent,#F0B429)] text-[var(--onboarding-text,#0F172A)]"
                                              : "border-black/20 bg-[var(--onboarding-surface,#FFFFFF)] text-[var(--onboarding-muted,#475569)]"
                                    }`}
                                >{step.complete ? "✓" : actualIndex + 1}</div>}

                                {!isLastVisible && (
                                    <div className="h-0.5 bg-[color-mix(in_srgb,var(--onboarding-muted,#475569)_30%,transparent)]" />
                                )}
                            </div>
                        )
                    })}

                    <div
                        className={`h-0.5 ${
                            showRightLine ? "bg-[color-mix(in_srgb,var(--onboarding-muted,#475569)_30%,transparent)]" : "bg-transparent"
                        }`}
                    />
                </div>
            </div>
        </div>
    )
}
