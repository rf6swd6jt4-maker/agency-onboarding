import { NeedHelpCard } from "./NeedHelpCard"
import { ProfileMenu } from "./ProfileMenu"
import { Roadmap } from "./Roadmap"
import { MobileStepBar } from "./MobileStepBar"
import { ClientBrandLogo } from "@/components/client-branding/ClientBrandLogo"
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
    logoSrc?: string | null
    help: OnboardingHelpSettings
    embedded?: boolean
    fullWindowPreview?: boolean
    forceMobile?: boolean
    footerText?: string
    privacyPolicyUrl?: string | null
    termsOfServiceUrl?: string | null
    onRoadmapSelect?: (stepKey: string) => void
    allowRoadmapNavigation?: boolean
    clientSession?: boolean
    helpSelected?: boolean
    onHelpSelect?: () => void
}

export function OnboardingLayout({
    children,
    roadmapSteps,
    client,
    headerActions,
    workspaceName,
    logoSrc,
    help,
    embedded = false,
    fullWindowPreview = false,
    forceMobile = false,
    footerText = "Progress saved automatically",
    privacyPolicyUrl,
    termsOfServiceUrl,
    onRoadmapSelect,
    allowRoadmapNavigation = false,
    clientSession = false,
    helpSelected = false,
    onHelpSelect,
}: OnboardingLayoutProps) {
    const helpCard = (id: string) => <div id={id} data-onboarding-help-card data-builder-help-block={onHelpSelect ? "true" : undefined} onClick={onHelpSelect} className={`rounded-2xl outline-offset-4 transition ${onHelpSelect ? "cursor-pointer hover:outline hover:outline-1 hover:outline-black/15" : ""} ${helpSelected ? "outline-2 outline-[var(--onboarding-accent,#F0B429)]" : ""}`}><NeedHelpCard help={help} /></div>
    return (
        <main data-client-onboarding-session={clientSession ? "true" : undefined} data-onboarding-full-window-preview={fullWindowPreview ? "true" : undefined} className={fullWindowPreview
            ? "relative flex h-full min-h-0 w-full flex-col overflow-hidden bg-[var(--onboarding-page,#F8F7F3)] text-[var(--onboarding-text,#0F172A)]"
            : forceMobile
            ? embedded
                ? "relative flex h-full min-h-[34rem] flex-col overflow-hidden rounded-2xl border border-black/10 bg-[var(--onboarding-page,#F8F7F3)] text-[var(--onboarding-text,#0F172A)] shadow-2xl shadow-black/30"
                : "relative flex h-full min-h-0 flex-col overflow-hidden bg-[var(--onboarding-page,#F8F7F3)] text-[var(--onboarding-text,#0F172A)]"
            : embedded
                ? "relative flex h-full min-h-[34rem] flex-col overflow-hidden rounded-2xl border border-black/10 bg-[var(--onboarding-page,#F8F7F3)] text-[var(--onboarding-text,#0F172A)] shadow-2xl shadow-black/30"
                : "flex min-h-[100svh] flex-col bg-[var(--onboarding-page,#F8F7F3)] text-[var(--onboarding-text,#0F172A)] lg:fixed lg:inset-0 lg:h-auto lg:min-h-0 lg:w-full lg:overflow-hidden"}>
            <header className={`h-14 shrink-0 border-b border-black/10 bg-[var(--onboarding-surface,#FFFFFF)] px-3 ${forceMobile ? "" : "sm:h-16 sm:px-6"}`}>
                <div className="mx-auto flex h-full max-w-7xl items-center justify-between">
                    <ClientBrandLogo
                        logoSrc={logoSrc}
                        workspaceName={workspaceName}
                        className={`h-8 ${headerActions ? "max-w-[calc(100vw-10rem)]" : "max-w-[min(12rem,calc(100vw-5.5rem))]"} ${forceMobile ? "" : "sm:h-9 sm:max-w-[min(12rem,52vw)]"}`}
                        fallbackClassName={`min-w-0 truncate text-base font-semibold text-[var(--onboarding-primary,#1E3A5F)] ${headerActions ? "max-w-[calc(100vw-10rem)]" : "max-w-[min(12rem,calc(100vw-5.5rem))]"} ${forceMobile ? "" : "sm:max-w-[min(20rem,55vw)] sm:text-xl"}`}
                    />

                    <div className="ml-2 flex shrink-0 items-center gap-2 sm:gap-3">
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
                ? "mx-auto grid min-h-0 w-full max-w-7xl flex-1 gap-5 overflow-y-auto px-3 pb-36 pt-3"
                : fullWindowPreview
                    ? "mx-auto grid min-h-0 w-full max-w-7xl flex-1 gap-5 overflow-y-auto px-3 pb-[calc(9rem+env(safe-area-inset-bottom))] pt-3 sm:gap-6 sm:px-6 sm:pt-4 lg:grid-cols-[220px_minmax(0,1fr)] lg:overflow-hidden lg:py-6 xl:grid-cols-[260px_minmax(0,1fr)_260px]"
                : `mx-auto grid w-full max-w-7xl gap-5 px-3 pb-[calc(9rem+env(safe-area-inset-bottom))] pt-3 sm:gap-6 sm:px-6 sm:pt-4 lg:min-h-0 lg:flex-1 lg:grid-cols-[220px_minmax(0,1fr)] lg:overflow-hidden lg:py-6 ${embedded ? "xl:grid-cols-[220px_minmax(0,1fr)_220px]" : "xl:grid-cols-[260px_minmax(0,1fr)_260px]"}`}>
                <aside className={forceMobile ? "hidden" : "hidden lg:min-h-0 lg:overflow-hidden lg:block"}>
                    <Roadmap steps={roadmapSteps} onSelect={onRoadmapSelect} allowAllSteps={allowRoadmapNavigation} />
                </aside>

                <section
                    id="onboarding-scroll-area"
                    className={forceMobile ? "min-w-0" : "min-w-0 lg:min-h-0 lg:overflow-y-auto lg:overscroll-contain lg:pb-10"}
                >
                    {children}

                    <div className={forceMobile ? "mt-5" : "mt-5 sm:mt-6 xl:hidden"}>
                        {helpCard("onboarding-help-inline")}
                    </div>
                </section>

                <aside className={forceMobile ? "hidden" : "hidden min-h-0 overflow-hidden xl:block"}>
                    {helpCard("onboarding-help-sidebar")}
                </aside>
            </div>

            <div className={forceMobile ? "hidden" : "hidden shrink-0 border-t border-black/10 bg-[var(--onboarding-surface,#FFFFFF)] px-6 py-3 text-sm font-medium text-[var(--onboarding-muted,#475569)] lg:block"}>
                <div className="mx-auto flex max-w-7xl items-center justify-center gap-4">
                    <span>{footerText}</span>
                    {privacyPolicyUrl ? <a href={privacyPolicyUrl} className="underline decoration-black/20 underline-offset-2 hover:text-[var(--onboarding-text,#0F172A)]">Privacy</a> : null}
                    {termsOfServiceUrl ? <a href={termsOfServiceUrl} className="underline decoration-black/20 underline-offset-2 hover:text-[var(--onboarding-text,#0F172A)]">Terms</a> : null}
                </div>
            </div>

            <MobileStepBar steps={roadmapSteps} embedded={embedded || forceMobile} forceVisible={forceMobile} footerText={footerText} privacyPolicyUrl={privacyPolicyUrl} termsOfServiceUrl={termsOfServiceUrl} onSelect={onRoadmapSelect} allowAllSteps={allowRoadmapNavigation} />
        </main>
    )
}
