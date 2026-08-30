import { createHash, randomBytes } from "crypto"
import { NextRequest, NextResponse } from "next/server"
import { getCanonicalSessionByToken } from "@/lib/onboarding/canonical"
import { META_ADS_GRAPH_VERSION } from "@/lib/workspace-integrations"
import { supabaseAdmin } from "@/lib/supabase/admin"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function clientRedirectUri(origin: string) {
    return process.env.META_ADS_CLIENT_OAUTH_REDIRECT_URI?.trim()
        || new URL("/api/onboarding/meta-ads/callback", process.env.NEXT_PUBLIC_SITE_URL?.trim() || origin).toString()
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
    const { token } = await params
    const sessionBlockId = request.nextUrl.searchParams.get("block")?.trim()
    if (!sessionBlockId) return Response.json({ error: "The Facebook connection block is missing." }, { status: 400 })

    const resolved = await getCanonicalSessionByToken(token)
    if (!resolved || resolved.session.status !== "active") return Response.json({ error: "This onboarding session is not active." }, { status: 404 })

    const [{ data: block }, { data: workspaceConnection }] = await Promise.all([
        supabaseAdmin.from("relationship_onboarding_session_blocks")
            .select("id, definition")
            .eq("id", sessionBlockId)
            .eq("workspace_id", resolved.session.workspace_id)
            .eq("session_id", resolved.session.id)
            .eq("kind", "connection")
            .maybeSingle(),
        supabaseAdmin.from("workspace_integrations")
            .select("connection_status, enabled")
            .eq("workspace_id", resolved.session.workspace_id)
            .eq("provider", "meta_ads")
            .maybeSingle(),
    ])
    const definition = block?.definition && typeof block.definition === "object" ? block.definition as Record<string, unknown> : null
    if (!block || definition?.provider !== "meta_ads") return Response.json({ error: "This Facebook connection block is no longer available." }, { status: 404 })
    if (!workspaceConnection?.enabled || workspaceConnection.connection_status !== "connected") {
        return Response.json({ error: "The agency has not connected its Meta Ads Business Portfolio yet." }, { status: 409 })
    }

    const appId = process.env.META_ADS_APP_ID?.trim() || process.env.NEXT_PUBLIC_META_APP_ID?.trim()
    const configId = process.env.META_ADS_LOGIN_CONFIG_ID?.trim()
    if (!appId || !configId) return Response.json({ error: "The Betelgeze Meta Ads App is not configured." }, { status: 503 })

    const state = randomBytes(32).toString("base64url")
    const stateHash = createHash("sha256").update(state).digest("hex")
    const redirectUri = clientRedirectUri(request.nextUrl.origin)
    const { error } = await supabaseAdmin.from("onboarding_meta_ads_connection_attempts").insert({
        state_hash: stateHash,
        workspace_id: resolved.session.workspace_id,
        relationship_id: resolved.session.relationship_id,
        session_id: resolved.session.id,
        session_block_id: sessionBlockId,
        redirect_uri: redirectUri,
        expires_at: new Date(Date.now() + 10 * 60_000).toISOString(),
    })
    if (error) throw new Error(`Could not prepare the Facebook connection: ${error.message}`)

    const authorize = new URL(`https://www.facebook.com/${META_ADS_GRAPH_VERSION}/dialog/oauth`)
    authorize.searchParams.set("client_id", appId)
    authorize.searchParams.set("redirect_uri", redirectUri)
    authorize.searchParams.set("state", state)
    authorize.searchParams.set("response_type", "code")
    authorize.searchParams.set("config_id", configId)
    authorize.searchParams.set("scope", "business_management,ads_read")
    return NextResponse.redirect(authorize)
}
