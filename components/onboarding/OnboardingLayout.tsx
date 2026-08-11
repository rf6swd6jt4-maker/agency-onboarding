import { NeedHelpCard } from "./NeedHelpCard"
import { ProfileMenu } from "./ProfileMenu"
import { Roadmap } from "./Roadmap"
import { MobileStepBar } from "./MobileStepBar"
import type { OnboardingHelpSettings } from "@/lib/onboarding/configuration-types"

type RoadmapStep = {
    key: string
    title: string
    complete: boolean
    current: boolean
    href?: string | null
}

type OnboardingLayoutProps = {
    children: React.ReactNode
    roadmapSteps: RoadmapStep[]
    client: {
        name: string | null
        email: string | null
        phone: string | null
        isTest?: boolean
    }
    headerActions?: React.ReactNode
    workspaceName: string
    help: OnboardingHelpSettings
    embedded?: boolean
    forceMobile?: boolean
    footerText?: string
    onRoadmapSelect?: (stepKey: string) => void
    helpSelected?: boolean
    onHelpSelect?: () => void
}

export function OnboardingLayout({
    children,
    roadmapSteps,
    client,
    headerActions,
    workspaceName,
    help,
    embedded = false,
    forceMobile = false,
    footerText = "Progress saved automatically",
    onRoadmapSelect,
    helpSelected = false,
    onHelpSelect,
}: OnboardingLayoutProps) {
    const helpCard = <div data-builder-help-block={onHelpSelect ? "true" : undefined} onClick={onHelpSelect} className={`rounded-2xl outline-offset-4 transition ${onHelpSelect ? "cursor-pointer hover:outline hover:outline-1 hover:outline-black/15" : ""} ${helpSelected ? "outline-2 outline-[var(--onboarding-accent,#F0B429)]" : ""}`}><NeedHelpCard help={help} /></div>
    return (
        <main className={forceMobile
            ? embedded
                ? "relative flex h-full min-h-[34rem] flex-col overflow-hidden rounded-2xl border border-black/10 bg-[var(--onboarding-page,#F8F7F3)] text-[var(--onboarding-text,#0F172A)] shadow-2xl shadow-black/30"
                : "relative flex h-full min-h-0 flex-col overflow-hidden bg-[var(--onboarding-page,#F8F7F3)] text-[var(--onboarding-text,#0F172A)]"
            : embedded
                ? "relative flex h-full min-h-[34rem] flex-col overflow-hidden rounded-2xl border border-black/10 bg-[var(--onboarding-page,#F8F7F3)] text-[var(--onboarding-text,#0F172A)] shadow-2xl shadow-black/30"
                : "flex min-h-screen flex-col bg-[var(--onboarding-page,#F8F7F3)] text-[var(--onboarding-text,#0F172A)] lg:fixed lg:inset-0 lg:h-auto lg:min-h-0 lg:w-full lg:overflow-hidden"}>
            <header className={`h-16 shrink-0 border-b border-black/10 bg-[var(--onboarding-surface,#FFFFFF)] px-4 ${forceMobile ? "" : "sm:px-6"}`}>
                <div className="mx-auto flex h-full max-w-7xl items-center justify-between">
                    <p className="text-xl font-semibold text-[var(--onboarding-primary,#1E3A5F)]">
                        {workspaceName}
                    </p>

                    <div className="flex items-center gap-3">
                        {headerActions}

                        <ProfileMenu
                            name={client.name}
                            email={client.email}
                            phone={client.phone}
                            isTest={client.isTest}
                        />
                    </div>
                </div>
            </header>

            <div className={forceMobile
                ? "mx-auto grid min-h-0 w-full max-w-7xl flex-1 gap-6 overflow-y-auto px-4 pb-36 pt-4"
                : `mx-auto grid w-full max-w-7xl gap-6 px-4 pb-32 pt-4 sm:px-6 lg:min-h-0 lg:flex-1 lg:overflow-hidden lg:py-6 ${embedded ? "lg:grid-cols-[220px_minmax(0,1fr)] xl:grid-cols-[220px_minmax(0,1fr)_220px]" : "lg:grid-cols-[260px_minmax(0,1fr)_260px]"}`}>
                <aside className={forceMobile ? "hidden" : "hidden lg:min-h-0 lg:overflow-hidden lg:block"}>
                    <Roadmap steps={roadmapSteps} onSelect={onRoadmapSelect} />
                </aside>

                <section
                    id="onboarding-scroll-area"
                    className={forceMobile ? "min-w-0" : "min-w-0 lg:min-h-0 lg:overflow-y-auto lg:overscroll-contain lg:pb-10"}
                >
                    {children}

                    <div className={forceMobile ? "mt-6" : `mt-6 ${embedded ? "xl:hidden" : "lg:hidden"}`}>
                        {helpCard}
                    </div>
                </section>

                <aside className={forceMobile ? "hidden" : `${embedded ? "hidden xl:block" : "hidden lg:block"} min-h-0 overflow-hidden`}>
                    {helpCard}
                </aside>
            </div>

            <div className={forceMobile ? "hidden" : "hidden shrink-0 border-t border-black/10 bg-[var(--onboarding-surface,#FFFFFF)] px-6 py-3 text-center text-sm font-medium text-[var(--onboarding-muted,#475569)] lg:block"}>
                {footerText}
            </div>

            <MobileStepBar steps={roadmapSteps} embedded={embedded || forceMobile} forceVisible={forceMobile} footerText={footerText} onSelect={onRoadmapSelect} />
        </main>
    )
}
