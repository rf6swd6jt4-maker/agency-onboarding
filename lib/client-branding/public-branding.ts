import "server-only"

import type { Metadata } from "next"
import { headers } from "next/headers"

import { supabaseAdmin } from "@/lib/supabase/admin"

export type AgencyPublicBranding = {
    displayName: string
    privacyPolicyUrl: string | null
    termsOfServiceUrl: string | null
    metadataTitle: string | null
    metadataDescription: string | null
}

type AgencyPublicBrandingRow = {
    agency_display_name?: string | null
    agency_privacy_policy_url?: string | null
    agency_terms_of_service_url?: string | null
    agency_metadata_title?: string | null
    agency_metadata_description?: string | null
}

export type AgencyBrandedPage = "sms-opt-in" | "onboarding" | "client-portal"
export type ClientBrandingSurface = "onboarding" | "client-portal"

const TOKEN_PATTERN = /^[a-f0-9]{64}$/i

function optionalText(value: unknown) {
    return typeof value === "string" && value.trim() ? value.trim() : null
}

export function agencyPublicBranding(workspaceName: string, row?: AgencyPublicBrandingRow | null): AgencyPublicBranding {
    return {
        displayName: optionalText(row?.agency_display_name) ?? workspaceName,
        privacyPolicyUrl: optionalText(row?.agency_privacy_policy_url),
        termsOfServiceUrl: optionalText(row?.agency_terms_of_service_url),
        metadataTitle: optionalText(row?.agency_metadata_title),
        metadataDescription: optionalText(row?.agency_metadata_description),
    }
}

export async function loadWorkspacePublicBranding(workspaceId: string, workspaceName: string) {
    const { data, error } = await supabaseAdmin
        .from("workspaces")
        .select("agency_display_name, agency_privacy_policy_url, agency_terms_of_service_url, agency_metadata_title, agency_metadata_description")
        .eq("id", workspaceId)
        .maybeSingle()

    // Keep public pages available during a rolling database migration. A valid
    // workspace name remains an agency-owned fallback and never introduces BE.
    return agencyPublicBranding(workspaceName, error ? null : data)
}

function pageLabel(page: AgencyBrandedPage) {
    if (page === "sms-opt-in") return "SMS opt-in"
    if (page === "client-portal") return "Client Portal"
    return "Onboarding"
}

function defaultDescription(page: AgencyBrandedPage, displayName: string) {
    if (page === "sms-opt-in") return `Choose whether to receive service-related SMS messages from ${displayName}.`
    if (page === "client-portal") return `Access your client portal from ${displayName}.`
    return `Complete your client onboarding with ${displayName}.`
}

export function agencyBrandedMetadata(branding: AgencyPublicBranding | null, page: AgencyBrandedPage, canonicalUrl?: string | null): Metadata {
    const label = pageLabel(page)
    if (!branding) {
        const title = label
        return { title: { absolute: title } }
    }

    const siteTitle = branding.metadataTitle ?? branding.displayName
    const title = `${siteTitle} ${label}`
    const description = branding.metadataDescription ?? defaultDescription(page, branding.displayName)
    return {
        applicationName: siteTitle,
        title: { absolute: title },
        description,
        alternates: canonicalUrl ? { canonical: canonicalUrl } : undefined,
        openGraph: {
            type: "website",
            title,
            description,
            siteName: siteTitle,
            url: canonicalUrl ?? undefined,
        },
        twitter: {
            card: "summary",
            title,
            description,
        },
    }
}

export async function currentPublicPageUrl() {
    const requestHeaders = await headers()
    const host = requestHeaders.get("host")?.trim()
    if (!host || /[\s/\\]/u.test(host)) return null
    const forwardedProtocol = requestHeaders.get("x-forwarded-proto")?.split(",", 1)[0]?.trim().toLowerCase()
    const protocol = forwardedProtocol === "http" ? "http" : "https"
    const path = (requestHeaders.get("x-betelgeze-current-path") ?? "/").split("?", 1)[0]
    try {
        return new URL(path.startsWith("/") ? path : "/", `${protocol}://${host}`).toString()
    } catch {
        return null
    }
}

async function clientBrandingWorkspaceId(surface: ClientBrandingSurface, token: string) {
    if (!TOKEN_PATTERN.test(token)) return null
    if (surface === "client-portal") {
        const { data } = await supabaseAdmin
            .from("client_portal_sessions")
            .select("workspace_id, status, token_revoked_at")
            .eq("session_token", token.toLowerCase())
            .maybeSingle()
        return data?.status === "active" && !data.token_revoked_at ? data.workspace_id : null
    }

    const { data } = await supabaseAdmin
        .from("relationship_onboarding_sessions")
        .select("workspace_id, status, token_revoked_at")
        .eq("session_token", token.toLowerCase())
        .in("status", ["active", "completed"])
        .maybeSingle()
    return data && !data.token_revoked_at ? data.workspace_id : null
}

export async function loadClientPagePublicBranding(surface: ClientBrandingSurface, token: string) {
    const workspaceId = await clientBrandingWorkspaceId(surface, token)
    if (!workspaceId) return null
    const { data: workspace } = await supabaseAdmin
        .from("workspaces")
        .select("id, name, status")
        .eq("id", workspaceId)
        .eq("status", "active")
        .maybeSingle()
    return workspace ? loadWorkspacePublicBranding(workspace.id, workspace.name) : null
}
