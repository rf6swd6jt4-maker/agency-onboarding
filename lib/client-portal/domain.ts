import { normalizeOnboardingDomain } from "@/lib/onboarding/custom-domain"

export const normalizeClientPortalDomain = normalizeOnboardingDomain

export function getClientPortalUrl({
    sessionToken,
    customDomain,
    customDomainVerified = false,
}: {
    sessionToken: string
    customDomain?: string | null
    customDomainVerified?: boolean
}) {
    if (customDomain && customDomainVerified) return `https://${customDomain}/${sessionToken}`

    const baseUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000"
    return `${baseUrl}/client-portal/session/${sessionToken}`
}
