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
    forceVisible?: boolean
    footerText?: string
    privacyPolicyUrl?: string | null
    termsOfServiceUrl?: string | null
    onSelect?: (stepKey: string) => void
    allowAllSteps?: boolean
}

export function MobileStepBar({ steps, embedded = false, forceVisible = false, footerText = "Progress saved automatically", privacyPolicyUrl, termsOfServiceUrl, onSelect, allowAllSteps = false }: MobileStepBarProps) {
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
        <div className={`${embedded ? "absolute" : "fixed"} inset-x-0 bottom-0 z-30 touch-manipulation border-t border-black/10 bg-[var(--onboarding-surface,#FFFFFF)] shadow-[0_-8px_30px_rgba(15,23,42,0.12)] ${forceVisible ? "" : "lg:hidden"}`}>
            <div className="mx-auto max-w-xl px-3 py-2 sm:px-4">
                <div className="mb-2 flex items-center justify-between gap-3">
                    <div className="min-w-0">
                        <p className="text-[10px] font-semibold uppercase leading-3 tracking-wide text-[var(--onboarding-muted,#475569)]">
                            Current step
                        </p>

                        <p className="truncate text-xs font-semibold leading-4 text-[var(--onboarding-primary,#1E3A5F)] sm:text-sm sm:leading-5">
                            {currentStep?.title ?? "Onboarding"}
                        </p>
                    </div>

                    <p className="shrink-0 text-xs font-medium text-[var(--onboarding-muted,#475569)] sm:text-sm">
                        {stepNumber} of {steps.length}
                    </p>
                </div>

                <div className="grid grid-cols-[minmax(0,0.5fr)_44px_minmax(0,1fr)_44px_minmax(0,1fr)_44px_minmax(0,1fr)_44px_minmax(0,0.25fr)] items-center">
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
                                {onSelect && (allowAllSteps || step.complete || step.current) ? <button
                                    type="button"
                                    onClick={() => onSelect(step.key)}
                                    aria-label={`Open ${step.title}`}
                                    className={`flex h-11 w-11 items-center justify-center rounded-full border text-sm font-semibold ${
                                        step.complete
                                            ? "border-[var(--onboarding-primary,#1E3A5F)] bg-[var(--onboarding-primary,#1E3A5F)] text-white"
                                            : "border-[var(--onboarding-accent,#F0B429)] bg-[var(--onboarding-accent,#F0B429)] text-[var(--onboarding-text,#0F172A)]"
                                    }`}
                                >{step.complete ? "✓" : actualIndex + 1}</button> : step.href ? <Link
                                    href={step.href}
                                    aria-label={`Open ${step.title}`}
                                    className={`flex h-11 w-11 items-center justify-center rounded-full border text-sm font-semibold ${
                                        step.complete
                                            ? "border-[var(--onboarding-primary,#1E3A5F)] bg-[var(--onboarding-primary,#1E3A5F)] text-white"
                                            : step.current
                                              ? "border-[var(--onboarding-accent,#F0B429)] bg-[var(--onboarding-accent,#F0B429)] text-[var(--onboarding-text,#0F172A)]"
                                              : "border-black/20 bg-[var(--onboarding-surface,#FFFFFF)] text-[var(--onboarding-muted,#475569)]"
                                    }`}
                                >
                                    {step.complete ? "✓" : actualIndex + 1}
                                </Link> : <div
                                    className={`flex h-11 w-11 items-center justify-center rounded-full border text-sm font-semibold ${
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
            <div data-mobile-preview-footer className="flex items-center justify-center gap-2 border-t border-black/10 px-3 py-2 pb-[max(0.75rem,env(safe-area-inset-bottom))] text-center text-xs font-medium leading-4 text-[var(--onboarding-muted,#475569)] sm:gap-3 sm:px-4">
                <span className="min-w-0 truncate">{footerText}</span>
                {privacyPolicyUrl ? <a href={privacyPolicyUrl} className="shrink-0 underline decoration-black/20 underline-offset-2">Privacy</a> : null}
                {termsOfServiceUrl ? <a href={termsOfServiceUrl} className="shrink-0 underline decoration-black/20 underline-offset-2">Terms</a> : null}
            </div>
        </div>
    )
}
