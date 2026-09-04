import type { Metadata } from "next"
import { ClientPortalShell } from "@/components/client-portal/ClientPortalShell"
import { OnboardingThemeProvider } from "@/components/onboarding/OnboardingThemeProvider"
import { loadClientPortalSessionByToken } from "@/lib/client-portal/session"
import { clientFaviconIcons } from "@/lib/client-branding/favicon"
import { agencyBrandedMetadata, currentPublicPageUrl, loadClientPagePublicBranding, loadWorkspacePublicBranding } from "@/lib/client-branding/public-branding"

export const dynamic = "force-dynamic"

type PageProps = {
    params: Promise<{ token: string }>
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
    const { token } = await params
    const [branding, icons, canonicalUrl] = await Promise.all([
        loadClientPagePublicBranding("client-portal", token),
        clientFaviconIcons("client-portal", token),
        currentPublicPageUrl(),
    ])
    return {
        ...agencyBrandedMetadata(branding, "client-portal", canonicalUrl),
        robots: { index: false, follow: false },
        icons,
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
    const publicBranding = await loadWorkspacePublicBranding(workspace.id, workspace.name)
    return <OnboardingThemeProvider theme={theme}>
        <ClientPortalShell token={token} workspaceName={publicBranding.displayName} primaryPersonName={relationship.primary_person_name} privacyPolicyUrl={publicBranding.privacyPolicyUrl} termsOfServiceUrl={publicBranding.termsOfServiceUrl} />
    </OnboardingThemeProvider>
}
