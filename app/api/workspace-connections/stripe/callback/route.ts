import { NextRequest } from "next/server"
import { consumeConnectionAttempt, finishConnectionAttempt, stageWorkspaceIntegrationCandidate, verifyAndActivateWorkspaceIntegrationCandidate } from "@/lib/workspace-integrations"
import { supabaseAdmin } from "@/lib/supabase/admin"
import { requireWorkspace } from "@/lib/workspaces"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function popupResponse(ok: boolean, error?: string) {
    const message = JSON.stringify({ type: "betelgeze:connection", provider: "stripe", ok, error: error ?? null }).replace(/</g, "\\u003c")
    return new Response(`<!doctype html><html><head><meta charset="utf-8"><title>Stripe connection</title></head><body style="margin:0;background:#0a0a0a;color:#fff;font:15px system-ui;display:grid;min-height:100vh;place-items:center"><main style="max-width:420px;padding:32px;text-align:center"><h1>${ok ? "Stripe connected" : "Stripe connection failed"}</h1><p style="color:#a3a3a3;line-height:1.6">${ok ? "This window will close and Settings will refresh." : "Return to Settings to review the error and try again."}</p></main><script>window.opener?.postMessage(${message}, window.location.origin);${ok ? "window.close();" : ""}</script></body></html>`, { status: ok ? 200 : 400, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'" } })
}

export async function GET(request: NextRequest) {
    const url = new URL(request.url)
    const state = url.searchParams.get("state")
    const code = url.searchParams.get("code")
    const providerError = url.searchParams.get("error_description") ?? url.searchParams.get("error")
    if (!state) return popupResponse(false, "Stripe did not return the secure connection state.")
    let attempt: Awaited<ReturnType<typeof consumeConnectionAttempt>> | null = null
    try {
        attempt = await consumeConnectionAttempt(state, "stripe")
        if (providerError || !code) throw new Error(providerError ?? "Stripe did not authorize the connection.")
        const { data: workspace, error: workspaceError } = await supabaseAdmin.from("workspaces").select("slug").eq("id", attempt.workspace_id).single()
        if (workspaceError || !workspace) throw new Error("The workspace for this connection no longer exists.")
        const authenticated = await requireWorkspace(workspace.slug, "owner")
        if (authenticated.user.id !== attempt.requested_by) throw new Error("Finish this connection with the same Betelgeze account that started it.")
        const mode = attempt.metadata?.mode === "test" ? "test" : "live"
        const developerKey = mode === "test" ? process.env.STRIPE_APP_TEST_SECRET_KEY : process.env.STRIPE_APP_LIVE_SECRET_KEY
        if (!developerKey) throw new Error(`The Betelgeze Stripe App ${mode} key is not configured.`)
        const body = new URLSearchParams({ code, grant_type: "authorization_code" })
        const tokenResponse = await fetch("https://api.stripe.com/v1/oauth/token", { method: "POST", headers: { Authorization: `Basic ${Buffer.from(`${developerKey}:`).toString("base64")}`, "Content-Type": "application/x-www-form-urlencoded" }, body })
        const token = await tokenResponse.json() as { access_token?: string; refresh_token?: string; stripe_user_id?: string; account_id?: string; livemode?: boolean; scope?: string; error_description?: string }
        if (!tokenResponse.ok || !token.access_token || !token.refresh_token) throw new Error(token.error_description ?? "Stripe could not exchange the authorization code.")
        await stageWorkspaceIntegrationCandidate({ workspaceId: attempt.workspace_id, provider: "stripe", authMethod: "oauth", userId: authenticated.user.id, config: {
            access_token: token.access_token,
            refresh_token: token.refresh_token,
            account_id: token.stripe_user_id ?? token.account_id ?? "",
            livemode: String(Boolean(token.livemode)),
            scope: token.scope ?? "stripe_apps",
            access_token_expires_at: String(Date.now() + 60 * 60_000),
            default_currency: process.env.STRIPE_DEFAULT_CURRENCY ?? "usd",
        } })
        await verifyAndActivateWorkspaceIntegrationCandidate(attempt.workspace_id, "stripe")
        await finishConnectionAttempt(attempt.id)
        return popupResponse(true)
    } catch (error) {
        const message = error instanceof Error ? error.message : "Stripe could not be connected."
        if (attempt) await finishConnectionAttempt(attempt.id, message)
        return popupResponse(false, message)
    }
}
