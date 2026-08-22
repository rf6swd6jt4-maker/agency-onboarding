import type { Metadata } from "next"
import { OnboardingThemeProvider } from "@/components/onboarding/OnboardingThemeProvider"
import { loadClientPortalSessionByToken } from "@/lib/client-portal/session"
import { clientFaviconIcons } from "@/lib/client-branding/favicon"

export const dynamic = "force-dynamic"

type PageProps = {
    params: Promise<{ token: string }>
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
    const { token } = await params
    return {
        title: "Client portal",
        robots: { index: false, follow: false },
        icons: await clientFaviconIcons("client-portal", token),
    }
}

function firstName(name: string) {
    return name.trim().split(/\s+/)[0] || "there"
}

export default async function ClientPortalSessionPage({ params }: PageProps) {
    const { token } = await params
    const resolved = await loadClientPortalSessionByToken(token)

    if (!resolved) {
        return <main data-betelgeze-client-portal-session="invalid" className="flex min-h-screen items-center justify-center bg-[#F8F7F3] px-6 text-center text-slate-900">
            <div><h1 className="text-xl font-semibold">This portal link is not available</h1><p className="mt-2 text-sm text-slate-600">Ask your agency for a new client portal link.</p></div>
        </main>
    }

    const { workspace, relationship, theme } = resolved
    return <OnboardingThemeProvider theme={theme}>
        <div data-betelgeze-client-portal-session="valid" className="min-h-screen bg-[var(--onboarding-page,#F8F7F3)] text-[var(--onboarding-text,#0F172A)]">
            <header className="border-b border-black/10 bg-[var(--onboarding-surface,#FFFFFF)]">
                <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-5 py-5 sm:px-8">
                    <p className="text-lg font-semibold tracking-tight">{workspace.name}</p>
                    <p className="text-sm font-medium text-[var(--onboarding-muted,#475569)]">Client portal</p>
                </div>
            </header>
            <main className="mx-auto max-w-5xl px-5 py-10 sm:px-8 sm:py-14">
                <div className="max-w-2xl">
                    <p className="font-medium text-[var(--onboarding-primary,#1E3A5F)]">Welcome, {firstName(relationship.primary_person_name)}</p>
                    <h1 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">Your portal is ready</h1>
                    <p className="mt-4 text-base leading-7 text-[var(--onboarding-muted,#475569)]">This is your simple, private place to follow the work with {workspace.name}.</p>
                </div>

                <section className="mt-8 rounded-3xl border border-black/10 bg-[var(--onboarding-surface,#FFFFFF)] p-6 shadow-sm sm:p-8">
                    <div className="flex items-start gap-4">
                        <span aria-hidden="true" className="mt-1 flex h-8 w-8 shrink-0 rotate-45 items-center justify-center rounded-sm bg-[var(--onboarding-accent,#F0B429)]"><span className="-rotate-45 text-sm font-bold text-[var(--onboarding-text,#0F172A)]">✓</span></span>
                        <div>
                            <h2 className="text-xl font-semibold">Onboarding complete</h2>
                            <p className="mt-2 max-w-2xl text-base leading-7 text-[var(--onboarding-muted,#475569)]">We have received your information. The team is reviewing it and preparing the next stage of your work.</p>
                        </div>
                    </div>
                </section>

                <section className="mt-5 rounded-3xl bg-[var(--onboarding-primary,#1E3A5F)] p-6 text-white sm:p-8">
                    <h2 className="text-lg font-semibold">What happens next?</h2>
                    <p className="mt-2 max-w-2xl leading-7 text-white/80">Keep this link somewhere safe. Messages, files, progress and results will appear here as your work moves forward.</p>
                </section>
            </main>
        </div>
    </OnboardingThemeProvider>
}
