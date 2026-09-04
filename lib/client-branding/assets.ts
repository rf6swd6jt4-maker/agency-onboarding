import type { Metadata } from "next"

import { supabaseAdmin } from "@/lib/supabase/admin"

export type ClientBrandingSurface = "onboarding" | "client-portal" | "sms-opt-in"
export type ClientBrandAssetKind = "logo" | "favicon"

const TOKEN_PATTERN = /^[a-f0-9]{64}$/i
const WORKSPACE_SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$/i

function isMissingBrandAssetSchema(error: { code?: string; message?: string } | null | undefined) {
    return error?.code === "42703" || error?.code === "PGRST204" || /schema cache|could not find/iu.test(error?.message ?? "")
}
function validStoredPath(workspaceId: string, kind: ClientBrandAssetKind, value: unknown) {
    return typeof value === "string" && value.startsWith(`${workspaceId}/client-branding/${kind}/`) ? value : null
}

function validLegacyFaviconPath(workspaceId: string, value: unknown) {
    return typeof value === "string" && value.startsWith(`${workspaceId}/workspace/`) ? value : null
}

export async function loadWorkspaceClientBrandAssets(workspaceId: string) {
    const { data, error } = await supabaseAdmin
        .from("workspaces")
        .select("agency_logo_path, agency_favicon_path, logo_path")
        .eq("id", workspaceId)
        .maybeSingle()

    if (!error && data) {
        return {
            logoPath: validStoredPath(workspaceId, "logo", data.agency_logo_path),
            faviconPath: validStoredPath(workspaceId, "favicon", data.agency_favicon_path) ?? validLegacyFaviconPath(workspaceId, data.logo_path),
            schemaReady: true,
        }
    }

    if (!isMissingBrandAssetSchema(error)) return { logoPath: null, faviconPath: null, schemaReady: false }
    const legacy = await supabaseAdmin.from("workspaces").select("logo_path").eq("id", workspaceId).maybeSingle()
    return {
        logoPath: null,
        faviconPath: validLegacyFaviconPath(workspaceId, legacy.data?.logo_path),
        schemaReady: false,
    }
}

async function clientBrandingWorkspaceId(surface: ClientBrandingSurface, key: string) {
    if (surface === "sms-opt-in") {
        if (!WORKSPACE_SLUG_PATTERN.test(key)) return null
        const { data } = await supabaseAdmin.from("workspaces").select("id, status").eq("slug", key.toLowerCase()).maybeSingle()
        return data?.status === "active" ? data.id : null
    }

    if (!TOKEN_PATTERN.test(key)) return null
    if (surface === "client-portal") {
        const { data } = await supabaseAdmin
            .from("client_portal_sessions")
            .select("workspace_id, status, token_revoked_at")
            .eq("session_token", key.toLowerCase())
            .maybeSingle()
        return data?.status === "active" && !data.token_revoked_at ? data.workspace_id : null
    }

    const { data } = await supabaseAdmin
        .from("relationship_onboarding_sessions")
        .select("workspace_id, status, token_revoked_at")
        .eq("session_token", key.toLowerCase())
        .in("status", ["active", "completed"])
        .maybeSingle()
    return data && !data.token_revoked_at ? data.workspace_id : null
}

function assetUrl(kind: ClientBrandAssetKind, surface: ClientBrandingSurface, key: string, storagePath: string | null) {
    if (!storagePath) return null
    const version = encodeURIComponent(storagePath.split("/").at(-1) ?? "1")
    return `/api/client-branding/${kind}/${surface}/${encodeURIComponent(key.toLowerCase())}?v=${version}`
}

export function clientBrandLogoUrl(surface: ClientBrandingSurface, key: string, storagePath: string | null) {
    return assetUrl("logo", surface, key, storagePath)
}

export async function resolveClientBrandAsset(surface: ClientBrandingSurface, key: string, kind: ClientBrandAssetKind) {
    const workspaceId = await clientBrandingWorkspaceId(surface, key)
    if (!workspaceId) return null
    const assets = await loadWorkspaceClientBrandAssets(workspaceId)
    const storagePath = kind === "logo" ? assets.logoPath : assets.faviconPath
    return storagePath ? { workspaceId, storagePath } : null
}

export async function resolveClientFavicon(surface: ClientBrandingSurface, key: string) {
    return resolveClientBrandAsset(surface, key, "favicon")
}

export async function clientFaviconIcons(surface: ClientBrandingSurface, key: string): Promise<Metadata["icons"] | undefined> {
    const favicon = await resolveClientFavicon(surface, key)
    if (!favicon) return undefined
    const url = assetUrl("favicon", surface, key, favicon.storagePath)!
    return {
        icon: { url, type: "image/png", sizes: "64x64" },
        shortcut: { url, type: "image/png", sizes: "64x64" },
    }
}
