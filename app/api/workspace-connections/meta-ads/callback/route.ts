import { NextRequest } from "next/server"
import {
    consumeConnectionAttempt,
    finishConnectionAttempt,
    getMetaAdsBusinessOptions,
    META_ADS_GRAPH_VERSION,
    selectMetaAdsWorkspaceIntegrationBusiness,
    stageMetaAdsWorkspaceIntegrationCandidate,
} from "@/lib/workspace-integrations"
import { supabaseAdmin } from "@/lib/supabase/admin"
import { requireWorkspace } from "@/lib/workspaces"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function popupResponse(origin: string, ok: boolean, options?: { error?: string; needsSelection?: boolean }) {
    const message = JSON.stringify({ type: "betelgeze:connection", provider: "meta_ads", ok, error: options?.error ?? null, needsSelection: Boolean(options?.needsSelection) }).replace(/</g, "\\u003c")
    const title = ok ? options?.needsSelection ? "Choose a Business Portfolio" : "Meta Ads connected" : "Meta Ads connection failed"
    const detail = ok
        ? options?.needsSelection ? "Return to Settings and choose the agency Business Portfolio." : "This window will close and Settings will refresh."
        : "Return to Settings to review the error and try again."
    return new Response(`<!doctype html><html><head><meta charset="utf-8"><title>Meta Ads connection</title></head><body style="margin:0;background:#0a0a0a;color:#fff;font:15px system-ui;display:grid;min-height:100vh;place-items:center"><main style="max-width:420px;padding:32px;text-align:center"><h1>${title}</h1><p style="color:#a3a3a3;line-height:1.6">${detail}</p></main><script>window.opener?.postMessage(${message}, ${JSON.stringify(origin)});${ok ? "window.close();" : ""}</script></body></html>`, { status: ok ? 200 : 400, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'" } })
}

export async function GET(request: NextRequest) {
    const url = new URL(request.url)
    const state = url.searchParams.get("state")
    const code = url.searchParams.get("code")
    const providerError = url.searchParams.get("error_description") ?? url.searchParams.get("error_message") ?? url.searchParams.get("error")
    if (!state) return popupResponse(url.origin, false, { error: "Meta did not return the secure connection state." })
    let attempt: Awaited<ReturnType<typeof consumeConnectionAttempt>> | null = null
    let openerOrigin = url.origin
    try {
        attempt = await consumeConnectionAttempt(state, "meta_ads")
        if (typeof attempt.metadata?.opener_origin === "string") openerOrigin = attempt.metadata.opener_origin
        if (providerError || !code) throw new Error(providerError ?? "Meta did not authorize the connection.")
        const { data: workspace, error: workspaceError } = await supabaseAdmin.from("workspaces").select("slug").eq("id", attempt.workspace_id).single()
        if (workspaceError || !workspace) throw new Error("The workspace for this connection no longer exists.")
        const authenticated = await requireWorkspace(workspace.slug, "owner")
        if (authenticated.user.id !== attempt.requested_by) throw new Error("Finish this connection with the same Betelgeze account that started it.")

        const appId = process.env.META_ADS_APP_ID?.trim() || process.env.NEXT_PUBLIC_META_APP_ID?.trim()
        const appSecret = process.env.META_ADS_APP_SECRET?.trim() || process.env.META_APP_SECRET?.trim()
        const redirectUri = typeof attempt.metadata?.redirect_uri === "string" ? attempt.metadata.redirect_uri : null
        if (!appId || !appSecret || !redirectUri) throw new Error("The Betelgeze Meta Ads App credentials are incomplete.")

        const exchangeUrl = new URL(`https://graph.facebook.com/${META_ADS_GRAPH_VERSION}/oauth/access_token`)
        exchangeUrl.searchParams.set("client_id", appId)
        exchangeUrl.searchParams.set("client_secret", appSecret)
        exchangeUrl.searchParams.set("redirect_uri", redirectUri)
        exchangeUrl.searchParams.set("code", code)
        const exchangeResponse = await fetch(exchangeUrl, { cache: "no-store" })
        const exchange = await exchangeResponse.json() as { access_token?: string; expires_in?: number; error?: { message?: string } }
        if (!exchangeResponse.ok || !exchange.access_token) throw new Error(exchange.error?.message ?? "Meta could not exchange the authorization code.")

        const longLivedUrl = new URL(`https://graph.facebook.com/${META_ADS_GRAPH_VERSION}/oauth/access_token`)
        longLivedUrl.searchParams.set("grant_type", "fb_exchange_token")
        longLivedUrl.searchParams.set("client_id", appId)
        longLivedUrl.searchParams.set("client_secret", appSecret)
        longLivedUrl.searchParams.set("fb_exchange_token", exchange.access_token)
        const longLivedResponse = await fetch(longLivedUrl, { cache: "no-store" })
        const longLived = await longLivedResponse.json() as { access_token?: string; expires_in?: number; error?: { message?: string } }
        if (!longLivedResponse.ok || !longLived.access_token) throw new Error(longLived.error?.message ?? "Meta authorized the account but did not issue a durable access token.")

        const identity = await getMetaAdsBusinessOptions(longLived.access_token)
        if (!identity.businesses.length) throw new Error("This Facebook account does not have access to a Business Portfolio. Ask the agency owner to grant portfolio access, then reconnect.")
        const expiresAt = new Date(Date.now() + Math.max(60, longLived.expires_in ?? exchange.expires_in ?? 0) * 1_000).toISOString()
        await stageMetaAdsWorkspaceIntegrationCandidate({
            workspaceId: attempt.workspace_id,
            userId: authenticated.user.id,
            accessToken: longLived.access_token,
            accessTokenExpiresAt: expiresAt,
            facebookUserId: identity.userId,
            facebookUserName: identity.userName,
            businesses: identity.businesses,
        })
        const needsSelection = identity.businesses.length > 1
        if (!needsSelection) await selectMetaAdsWorkspaceIntegrationBusiness(attempt.workspace_id, identity.businesses[0].id, authenticated.user.id)
        await finishConnectionAttempt(attempt.id)
        return popupResponse(openerOrigin, true, { needsSelection })
    } catch (error) {
        const message = error instanceof Error ? error.message : "Meta Ads could not be connected."
        if (attempt) await finishConnectionAttempt(attempt.id, message)
        return popupResponse(openerOrigin, false, { error: message })
    }
}
