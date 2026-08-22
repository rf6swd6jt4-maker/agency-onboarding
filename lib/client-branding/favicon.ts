import type { Metadata } from "next"
import { supabaseAdmin } from "@/lib/supabase/admin"

export type ClientBrandingSurface = "onboarding" | "client-portal"

const TOKEN_PATTERN = /^[a-f0-9]{64}$/i

async function faviconWorkspaceId(surface: ClientBrandingSurface, token: string) {
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

export async function resolveClientFavicon(surface: ClientBrandingSurface, token: string) {
    const workspaceId = await faviconWorkspaceId(surface, token)
    if (!workspaceId) return null

    const { data: workspace } = await supabaseAdmin
        .from("workspaces")
        .select("id, logo_path, status")
        .eq("id", workspaceId)
        .eq("status", "active")
        .maybeSingle()
    if (!workspace?.logo_path || !workspace.logo_path.startsWith(`${workspace.id}/workspace/`)) return null

    return { workspaceId: workspace.id, storagePath: workspace.logo_path }
}

export async function clientFaviconIcons(surface: ClientBrandingSurface, token: string): Promise<Metadata["icons"] | undefined> {
    const favicon = await resolveClientFavicon(surface, token)
    if (!favicon) return undefined

    const version = encodeURIComponent(favicon.storagePath.split("/").at(-1) ?? "1")
    const url = `/api/client-branding/favicon/${surface}/${token.toLowerCase()}?v=${version}`
    return {
        icon: { url, type: "image/png", sizes: "64x64" },
        shortcut: { url, type: "image/png", sizes: "64x64" },
    }
}
