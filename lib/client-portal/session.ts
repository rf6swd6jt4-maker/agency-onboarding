import { headers } from "next/headers"
import { getClientPortalUrl } from "@/lib/client-portal/domain"
import { loadPublishedOnboardingConfiguration } from "@/lib/onboarding/configuration"
import { supabaseAdmin } from "@/lib/supabase/admin"

export async function loadClientPortalSessionByToken(token: string) {
    if (!/^[a-f0-9]{64}$/i.test(token)) return null

    const requestHeaders = await headers()
    const workspaceSlug = requestHeaders.get("x-betelgeze-workspace-slug")
    const { data: session, error: sessionError } = await supabaseAdmin
        .from("client_portal_sessions")
        .select("id, workspace_id, relationship_id, onboarding_session_id, status, token_revoked_at, created_at")
        .eq("session_token", token.toLowerCase())
        .maybeSingle()
    if (sessionError || !session || session.status !== "active" || session.token_revoked_at) return null

    const workspaceQuery = supabaseAdmin
        .from("workspaces")
        .select("id, name, slug, status, custom_client_portal_domain, custom_client_portal_domain_status")
        .eq("id", session.workspace_id)
        .eq("status", "active")
    const [{ data: workspace }, { data: relationship }, configuration] = await Promise.all([
        workspaceSlug ? workspaceQuery.eq("slug", workspaceSlug).maybeSingle() : workspaceQuery.maybeSingle(),
        supabaseAdmin
            .from("relationships")
            .select("id, primary_person_name, business_name")
            .eq("workspace_id", session.workspace_id)
            .eq("id", session.relationship_id)
            .is("archived_at", null)
            .maybeSingle(),
        loadPublishedOnboardingConfiguration(session.workspace_id),
    ])
    if (!workspace || !relationship) return null

    await supabaseAdmin
        .from("client_portal_sessions")
        .update({ last_accessed_at: new Date().toISOString() })
        .eq("workspace_id", session.workspace_id)
        .eq("id", session.id)

    return { session, workspace, relationship, theme: configuration.theme }
}

export async function getClientPortalUrlForOnboardingSession(input: {
    workspaceId: string
    relationshipId: string
}) {
    const [{ data: portalSession }, { data: workspace }] = await Promise.all([
        supabaseAdmin
            .from("client_portal_sessions")
            .select("session_token, status, token_revoked_at")
            .eq("workspace_id", input.workspaceId)
            .eq("relationship_id", input.relationshipId)
            .maybeSingle(),
        supabaseAdmin
            .from("workspaces")
            .select("custom_client_portal_domain, custom_client_portal_domain_status")
            .eq("id", input.workspaceId)
            .maybeSingle(),
    ])
    if (!portalSession || portalSession.status !== "active" || portalSession.token_revoked_at || !workspace) return null
    return getClientPortalUrl({
        sessionToken: portalSession.session_token,
        customDomain: workspace.custom_client_portal_domain,
        customDomainVerified: workspace.custom_client_portal_domain_status === "verified",
    })
}
