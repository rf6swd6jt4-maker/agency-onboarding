import type { Metadata } from "next"
import { ClientPortalShell } from "@/components/client-portal/ClientPortalShell"
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
        <ClientPortalShell token={token} workspaceName={workspace.name} primaryPersonName={relationship.primary_person_name} />
    </OnboardingThemeProvider>
}
