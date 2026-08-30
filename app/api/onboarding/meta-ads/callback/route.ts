import { createHash } from "crypto"
import { NextRequest } from "next/server"
import {
    encryptIntegrationCredential,
    getMetaAdsAdAccountOptions,
    getMetaAdsBusinessOptions,
    META_ADS_GRAPH_VERSION,
} from "@/lib/workspace-integrations"
import { supabaseAdmin } from "@/lib/supabase/admin"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type Attempt = {
    state_hash: string
    workspace_id: string
    relationship_id: string
    session_id: string
    session_block_id: string
    redirect_uri: string
}

function terminalResponse(ok: boolean, message: string) {
    return new Response(`<!doctype html><html><head><meta charset="utf-8"><title>Facebook connection</title></head><body style="margin:0;background:#f8f7f3;color:#0f172a;font:15px system-ui;display:grid;min-height:100vh;place-items:center"><main style="max-width:440px;padding:32px;text-align:center"><h1>${ok ? "Facebook connected" : "Facebook connection failed"}</h1><p style="color:#475569;line-height:1.6">${message.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" })[character]!)}</p></main></body></html>`, { status: ok ? 200 : 400, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'" } })
}

async function onboardingDestination(sessionId: string, origin: string, result: "connected" | "error", reason?: string) {
    const { data: session } = await supabaseAdmin.from("relationship_onboarding_sessions").select("session_token").eq("id", sessionId).maybeSingle()
    if (!session?.session_token) return null
    const destination = new URL(`/onboarding/session/${session.session_token}`, process.env.NEXT_PUBLIC_SITE_URL?.trim() || origin)
    destination.searchParams.set("meta", result)
    if (reason) destination.searchParams.set("connection_reason", reason.slice(0, 500))
    return destination
}

export async function GET(request: NextRequest) {
    const state = request.nextUrl.searchParams.get("state")
    const code = request.nextUrl.searchParams.get("code")
    const providerError = request.nextUrl.searchParams.get("error_description") ?? request.nextUrl.searchParams.get("error_message") ?? request.nextUrl.searchParams.get("error")
    if (!state) return terminalResponse(false, "Facebook did not return the secure connection state.")

    const stateHash = createHash("sha256").update(state).digest("hex")
    const { data, error: consumeError } = await supabaseAdmin.from("onboarding_meta_ads_connection_attempts")
        .update({ used_at: new Date().toISOString() })
        .eq("state_hash", stateHash)
        .is("used_at", null)
        .gt("expires_at", new Date().toISOString())
        .select("state_hash, workspace_id, relationship_id, session_id, session_block_id, redirect_uri")
        .maybeSingle()
    const attempt = data as Attempt | null
    if (consumeError || !attempt) return terminalResponse(false, "This Facebook connection has expired or was already used. Return to onboarding and try again.")

    try {
        if (providerError || !code) throw new Error(providerError ?? "Facebook authorization was cancelled.")
        const appId = process.env.META_ADS_APP_ID?.trim() || process.env.NEXT_PUBLIC_META_APP_ID?.trim()
        const appSecret = process.env.META_ADS_APP_SECRET?.trim() || process.env.META_APP_SECRET?.trim()
        if (!appId || !appSecret) throw new Error("The Betelgeze Meta Ads App credentials are incomplete.")

        const exchangeUrl = new URL(`https://graph.facebook.com/${META_ADS_GRAPH_VERSION}/oauth/access_token`)
        exchangeUrl.searchParams.set("client_id", appId)
        exchangeUrl.searchParams.set("client_secret", appSecret)
        exchangeUrl.searchParams.set("redirect_uri", attempt.redirect_uri)
        exchangeUrl.searchParams.set("code", code)
        const exchangeResponse = await fetch(exchangeUrl, { cache: "no-store" })
        const exchange = await exchangeResponse.json() as { access_token?: string; expires_in?: number; error?: { message?: string } }
        if (!exchangeResponse.ok || !exchange.access_token) throw new Error(exchange.error?.message ?? "Facebook could not exchange the authorization code.")

        const durableUrl = new URL(`https://graph.facebook.com/${META_ADS_GRAPH_VERSION}/oauth/access_token`)
        durableUrl.searchParams.set("grant_type", "fb_exchange_token")
        durableUrl.searchParams.set("client_id", appId)
        durableUrl.searchParams.set("client_secret", appSecret)
        durableUrl.searchParams.set("fb_exchange_token", exchange.access_token)
        const durableResponse = await fetch(durableUrl, { cache: "no-store" })
        const durable = await durableResponse.json() as { access_token?: string; expires_in?: number; error?: { message?: string } }
        if (!durableResponse.ok || !durable.access_token) throw new Error(durable.error?.message ?? "Facebook did not issue a durable access token.")

        const [identity, adAccounts, stepResult] = await Promise.all([
            getMetaAdsBusinessOptions(durable.access_token),
            getMetaAdsAdAccountOptions(durable.access_token),
            supabaseAdmin.from("relationship_onboarding_session_blocks").select("session_step_id").eq("id", attempt.session_block_id).single(),
        ])
        if (stepResult.error || !stepResult.data?.session_step_id) throw new Error("The onboarding Facebook connection block no longer exists.")
        if (!identity.businesses.length && !adAccounts.length) throw new Error("Facebook connected, but no Business Portfolio or ad account was available to this user.")
        const expiresAt = new Date(Date.now() + Math.max(60, durable.expires_in ?? exchange.expires_in ?? 0) * 1_000).toISOString()
        let serviceRevisionId: string | null = null
        if (stepResult.data?.session_step_id) {
            const { data: step } = await supabaseAdmin.from("relationship_onboarding_session_steps").select("session_module_id").eq("id", stepResult.data.session_step_id).maybeSingle()
            if (step?.session_module_id) {
                const { data: sessionModule } = await supabaseAdmin.from("relationship_onboarding_session_modules").select("source_service_revision_id").eq("id", step.session_module_id).maybeSingle()
                serviceRevisionId = sessionModule?.source_service_revision_id ?? null
            }
        }

        const { error: connectionError } = await supabaseAdmin.from("relationship_meta_ads_connections").upsert({
            workspace_id: attempt.workspace_id,
            relationship_id: attempt.relationship_id,
            onboarding_session_id: attempt.session_id,
            source_session_block_id: attempt.session_block_id,
            service_revision_id: serviceRevisionId,
            status: "connected",
            facebook_user_id: identity.userId,
            facebook_user_name: identity.userName,
            credential_encrypted: encryptIntegrationCredential({ access_token: durable.access_token }),
            access_token_expires_at: expiresAt,
            businesses: identity.businesses,
            ad_accounts: adAccounts,
            connected_at: new Date().toISOString(),
            last_error: null,
        }, { onConflict: "workspace_id,relationship_id" })
        if (connectionError) throw new Error(`Facebook authorized successfully, but Betelgeze could not save the connection: ${connectionError.message}`)

        const { error: requirementError } = await supabaseAdmin.from("onboarding_block_requirements").upsert({
            workspace_id: attempt.workspace_id,
            session_id: attempt.session_id,
            session_step_id: stepResult.data.session_step_id,
            session_block_id: attempt.session_block_id,
            requirement_kind: "meta_ads_connected",
        }, { onConflict: "session_block_id" })
        if (requirementError) throw new Error(`Facebook connected, but onboarding could not record completion: ${requirementError.message}`)

        const destination = await onboardingDestination(attempt.session_id, request.nextUrl.origin, "connected")
        return destination ? Response.redirect(destination, 303) : terminalResponse(true, "Return to onboarding to continue.")
    } catch (error) {
        const message = error instanceof Error ? error.message : "Facebook could not be connected."
        await supabaseAdmin.from("onboarding_meta_ads_connection_attempts").update({ last_error: message }).eq("state_hash", attempt.state_hash)
        const destination = await onboardingDestination(attempt.session_id, request.nextUrl.origin, "error", message)
        return destination ? Response.redirect(destination, 303) : terminalResponse(false, message)
    }
}
