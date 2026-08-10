type WhyWeAskCardProps = {
    children: React.ReactNode
}

export function WhyWeAskCard({ children }: WhyWeAskCardProps) {
    return (
        <div className="rounded-2xl border-l-4 border-[var(--onboarding-accent,#F0B429)] bg-[color-mix(in_srgb,var(--onboarding-accent,#F0B429)_12%,var(--onboarding-surface,#FFFFFF))] p-5">
            <p className="font-semibold text-[var(--onboarding-primary,#1E3A5F)]">Why do we ask?</p>

            <div className="mt-2 text-sm leading-6 text-[var(--onboarding-muted,#475569)]">
                {children}
            </div>
        </div>
    )
}
