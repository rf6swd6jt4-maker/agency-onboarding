import { getRequiredEnv } from "@/lib/env"

export type OnboardingDomainDnsRecord = {
    type: "A" | "CNAME" | "TXT"
    name: string
    value: string
}

type VercelProjectDomain = {
    verified?: boolean
    verification?: Array<{ type?: string; domain?: string; value?: string }>
}

type VercelDomainConfig = {
    recommendedCNAME?: Array<{ rank?: number; value?: string }>
    recommendedIPv4?: Array<{ rank?: number; value?: string[] }>
}

type PublicDomainSurface = "onboarding" | "client_portal"

async function probePublicSession(domain: string, surface: PublicDomainSurface) {
    const token = "0".repeat(64)
    try {
        const probeParameter = surface === "client_portal"
            ? "__betelgeze_client_portal_domain_probe=1"
            : "__betelgeze_domain_probe=1"
        const response = await fetch(`https://${domain}/${token}?${probeParameter}`, {
            cache: "no-store",
            redirect: "manual",
            signal: AbortSignal.timeout(12_000),
        })
        const surfaceLabel = surface === "client_portal" ? "client portal" : "onboarding session"
        if (!response.ok) return `The domain did not reach the ${surfaceLabel}. Check the DNS record and wait for it to propagate.`
        const body = await response.text()
        const marker = surface === "client_portal"
            ? 'data-betelgeze-client-portal-session="invalid"'
            : 'data-betelgeze-onboarding-session="invalid"'
        return body.includes(marker)
            ? null
            : `The domain reached a different site instead of Betelgeze’s ${surfaceLabel}. Check the DNS record.`
    } catch {
        return "Betelgeze could not reach this domain over HTTPS. Check the DNS record and try again after propagation."
    }
}

function query() {
    const teamId = process.env.VERCEL_TEAM_ID?.trim()
    return teamId ? `?${new URLSearchParams({ teamId })}` : ""
}

function projectUrl(path = "", version = "v10") {
    return `https://api.vercel.com/${version}/projects/${encodeURIComponent(getRequiredEnv("VERCEL_PROJECT_ID"))}${path}${query()}`
}

function headers() {
    return {
        Authorization: `Bearer ${getRequiredEnv("VERCEL_API_TOKEN")}`,
        "Content-Type": "application/json",
    }
}

function recordsFrom(response: VercelProjectDomain, config: VercelDomainConfig, domain: string) {
    const records: OnboardingDomainDnsRecord[] = []
    for (const item of response.verification ?? []) {
        if ((item.type === "TXT" || item.type === "CNAME" || item.type === "A") && item.domain && item.value) {
            records.push({ type: item.type, name: item.domain, value: item.value })
        }
    }
    const cname = [...(config.recommendedCNAME ?? [])].sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99))[0]?.value
    if (cname) records.push({ type: "CNAME", name: domain, value: cname })
    if (!cname) {
        const ipv4 = [...(config.recommendedIPv4 ?? [])].sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99))[0]?.value?.[0]
        if (ipv4) records.push({ type: "A", name: domain, value: ipv4 })
    }
    return records.filter((record, index, all) => all.findIndex((item) => item.type === record.type && item.name === record.name && item.value === record.value) === index)
}

async function getProjectDomain(domain: string) {
    const response = await fetch(projectUrl(`/domains/${encodeURIComponent(domain)}`, "v9"), { headers: headers(), cache: "no-store" })
    if (!response.ok) return null
    return await response.json() as VercelProjectDomain
}

async function getDomainConfig(domain: string) {
    const params = new URLSearchParams({ projectIdOrName: getRequiredEnv("VERCEL_PROJECT_ID") })
    const teamId = process.env.VERCEL_TEAM_ID?.trim()
    if (teamId) params.set("teamId", teamId)
    const response = await fetch(`https://api.vercel.com/v6/domains/${encodeURIComponent(domain)}/config?${params}`, { headers: headers(), cache: "no-store" })
    if (!response.ok) return {} as VercelDomainConfig
    return await response.json() as VercelDomainConfig
}

async function attachPublicDomain(domain: string) {
    const response = await fetch(projectUrl("/domains"), {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({ name: domain }),
        cache: "no-store",
    })
    const projectDomain = response.ok ? await response.json() as VercelProjectDomain : await getProjectDomain(domain)
    if (!projectDomain) throw new Error("Vercel could not attach this domain to Betelgeze. Check that it is not assigned to another Vercel project.")
    const config = await getDomainConfig(domain)
    return { verified: Boolean(projectDomain.verified), records: recordsFrom(projectDomain, config, domain) }
}

async function verifyPublicDomain(domain: string, surface: PublicDomainSurface) {
    const response = await fetch(projectUrl(`/domains/${encodeURIComponent(domain)}/verify`, "v9"), {
        method: "POST",
        headers: headers(),
        cache: "no-store",
    })
    if (!response.ok) {
        const projectDomain = await getProjectDomain(domain)
        const config = await getDomainConfig(domain)
        return {
            verified: false,
            records: projectDomain ? recordsFrom(projectDomain, config, domain) : [],
            error: "Vercel could not verify this domain yet. Check the DNS records and try again.",
        }
    }
    const projectDomain = await response.json() as VercelProjectDomain
    const config = await getDomainConfig(domain)
    if (!projectDomain.verified) {
        return { verified: false, records: recordsFrom(projectDomain, config, domain), error: "Vercel has not verified this domain yet. Check the DNS records and try again." }
    }
    const probeError = await probePublicSession(domain, surface)
    return { verified: !probeError, records: recordsFrom(projectDomain, config, domain), error: probeError }
}

async function removePublicDomain(domain: string) {
    const response = await fetch(projectUrl(`/domains/${encodeURIComponent(domain)}`, "v9"), {
        method: "DELETE",
        headers: headers(),
        cache: "no-store",
    })
    if (!response.ok && response.status !== 404) throw new Error("Vercel could not remove this domain from Betelgeze.")
}

export const attachOnboardingDomain = attachPublicDomain
export const removeOnboardingDomain = removePublicDomain
export function verifyOnboardingDomain(domain: string) {
    return verifyPublicDomain(domain, "onboarding")
}

export const attachClientPortalDomain = attachPublicDomain
export const removeClientPortalDomain = removePublicDomain
export function verifyClientPortalDomain(domain: string) {
    return verifyPublicDomain(domain, "client_portal")
}
