import { NextRequest, NextResponse } from "next/server"
import { createConnectionAttempt } from "@/lib/workspace-integrations"
import { requireWorkspace } from "@/lib/workspaces"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function popupError(origin: string, error: string) {
    const message = JSON.stringify({ type: "betelgeze:connection", provider: "stripe", ok: false, error }).replace(/</g, "\\u003c")
    return new Response(`<!doctype html><html><body style="margin:0;background:#0a0a0a;color:#fff;font:15px system-ui;display:grid;min-height:100vh;place-items:center"><main style="max-width:420px;padding:32px;text-align:center"><h1>Stripe is not ready</h1><p style="color:#a3a3a3;line-height:1.6">Return to Settings to see what needs to be configured.</p></main><script>window.opener?.postMessage(${message}, ${JSON.stringify(origin)});</script></body></html>`, { status: 503, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'" } })
}

export async function GET(request: NextRequest) {
    const url = new URL(request.url)
    const workspaceSlug = url.searchParams.get("workspace")?.trim()
    const mode = url.searchParams.get("mode") === "test" ? "test" : "live"
    if (!workspaceSlug) return Response.json({ error: "Workspace is required." }, { status: 400 })
    const { workspace, user } = await requireWorkspace(workspaceSlug, "owner")
    const clientId = process.env.STRIPE_APP_OAUTH_CLIENT_ID
    const configuredAuthorizeUrl = mode === "test" ? process.env.STRIPE_APP_TEST_AUTHORIZE_URL : process.env.STRIPE_APP_LIVE_AUTHORIZE_URL
    if (!clientId && !configuredAuthorizeUrl) return popupError(url.origin, "Stripe App OAuth is not configured in Vercel yet. Use manual credentials or add the Stripe App settings in Vercel.")
    const redirectUri = new URL("/api/workspace-connections/stripe/callback", url.origin).toString()
    const state = await createConnectionAttempt({ workspaceId: workspace.id, provider: "stripe", authMethod: "oauth", userId: user.id, metadata: { mode, redirect_uri: redirectUri } })
    const authorize = new URL(configuredAuthorizeUrl ?? "https://marketplace.stripe.com/oauth/v2/authorize")
    if (!authorize.searchParams.has("client_id") && clientId) authorize.searchParams.set("client_id", clientId)
    authorize.searchParams.set("redirect_uri", redirectUri)
    authorize.searchParams.set("state", state)
    return NextResponse.redirect(authorize)
}
