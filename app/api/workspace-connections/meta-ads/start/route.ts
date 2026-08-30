import { NextRequest, NextResponse } from "next/server"
import { createConnectionAttempt, META_ADS_GRAPH_VERSION } from "@/lib/workspace-integrations"
import { supabaseAdmin } from "@/lib/supabase/admin"
import { requireWorkspace } from "@/lib/workspaces"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function popupError(origin: string, error: string) {
    const message = JSON.stringify({ type: "betelgeze:connection", provider: "meta_ads", ok: false, error }).replace(/</g, "\\u003c")
    return new Response(`<!doctype html><html><body style="margin:0;background:#0a0a0a;color:#fff;font:15px system-ui;display:grid;min-height:100vh;place-items:center"><main style="max-width:420px;padding:32px;text-align:center"><h1>Meta Ads is not ready</h1><p style="color:#a3a3a3;line-height:1.6">Return to Settings to review the connection.</p></main><script>window.opener?.postMessage(${message}, ${JSON.stringify(origin)});</script></body></html>`, { status: 503, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'" } })
}

function metaAdsRedirectUri(requestOrigin: string) {
    const configured = process.env.META_ADS_OAUTH_REDIRECT_URI?.trim()
    return configured || new URL("/api/workspace-connections/meta-ads/callback", process.env.NEXT_PUBLIC_SITE_URL?.trim() || requestOrigin).toString()
}

export async function GET(request: NextRequest) {
    const url = new URL(request.url)
    const workspaceSlug = url.searchParams.get("workspace")?.trim()
    if (!workspaceSlug) return Response.json({ error: "Workspace is required." }, { status: 400 })
    const { workspace, user } = await requireWorkspace(workspaceSlug, "owner")
    const { data: connection, error: connectionError } = await supabaseAdmin.from("workspace_integrations")
        .select("provider")
        .eq("workspace_id", workspace.id)
        .eq("provider", "meta_ads")
        .maybeSingle()
    if (connectionError || !connection) return popupError(url.origin, "Install the Meta Ads service template before connecting a Business Portfolio.")

    const appId = process.env.META_ADS_APP_ID?.trim() || process.env.NEXT_PUBLIC_META_APP_ID?.trim()
    const configId = process.env.META_ADS_LOGIN_CONFIG_ID?.trim()
    if (!appId || !configId) return popupError(url.origin, "The Betelgeze Meta Ads App and its Login for Business configuration are not configured yet.")
    const redirectUri = metaAdsRedirectUri(url.origin)
    const state = await createConnectionAttempt({
        workspaceId: workspace.id,
        provider: "meta_ads",
        authMethod: "oauth",
        userId: user.id,
        metadata: { redirect_uri: redirectUri, opener_origin: url.origin },
    })
    const authorize = new URL(`https://www.facebook.com/${META_ADS_GRAPH_VERSION}/dialog/oauth`)
    authorize.searchParams.set("client_id", appId)
    authorize.searchParams.set("redirect_uri", redirectUri)
    authorize.searchParams.set("state", state)
    authorize.searchParams.set("response_type", "code")
    authorize.searchParams.set("config_id", configId)
    authorize.searchParams.set("scope", "business_management,ads_read")
    return NextResponse.redirect(authorize)
}
