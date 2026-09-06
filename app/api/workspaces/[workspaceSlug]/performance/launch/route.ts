import { supabaseAdmin } from "@/lib/supabase/admin"
import { requireWorkspace } from "@/lib/workspaces"

export const dynamic = "force-dynamic"

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const TIMING_KEYS = new Set([
    "client_bootstrap_ms", "ttfb_ms", "fcp_ms", "lcp_ms", "shell_hydrated_ms",
    "initial_frame_mounted_ms", "initial_frame_loaded_ms", "panel_ready_ms", "presence_ready_ms",
    "proxy_session_ms", "server_auth_ms", "server_bootstrap_ms", "server_total_ms",
    "server_bootstrap_fallback",
])

function shortText(value: unknown, maximum: number, fallback = "unknown") {
    return typeof value === "string" && value.trim() ? value.trim().slice(0, maximum) : fallback
}

function safeTimings(value: unknown) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return {}
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).flatMap(([key, raw]) => {
        const number = Number(raw)
        return TIMING_KEYS.has(key) && Number.isFinite(number) && number >= 0 && number <= 120_000
            ? [[key, Math.round(number * 10) / 10]]
            : []
    }))
}

export async function POST(request: Request, context: { params: Promise<{ workspaceSlug: string }> }) {
    const { workspaceSlug } = await context.params
    const { workspace } = await requireWorkspace(workspaceSlug)
    const raw = await request.text()
    if (raw.length > 12_000) return Response.json({ error: "Performance payload is too large." }, { status: 413 })
    let input: Record<string, unknown> | null = null
    try {
        const parsed = JSON.parse(raw || "null") as unknown
        input = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null
    } catch {
        return Response.json({ error: "Invalid performance payload." }, { status: 400 })
    }
    const launchId = shortText(input?.launchId, 64, "")
    if (!UUID_PATTERN.test(launchId)) return Response.json({ error: "Invalid launch measurement." }, { status: 400 })
    const frameCount = Math.min(8, Math.max(0, Math.floor(Number(input?.frameCount) || 0)))
    const row = {
        workspace_id: workspace.id,
        launch_id: launchId,
        route_section: shortText(input?.routeSection, 60),
        navigation_type: shortText(input?.navigationType, 40),
        display_mode: shortText(input?.displayMode, 40),
        connection_type: shortText(input?.connectionType, 40, "") || null,
        device_class: shortText(input?.deviceClass, 40),
        deployment_sha: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 64) || null,
        timings: safeTimings(input?.timings),
        frame_count: frameCount,
        updated_at: new Date().toISOString(),
    }
    const { error } = await supabaseAdmin.from("workspace_launch_metrics").upsert(row, { onConflict: "workspace_id,launch_id" })
    if (error) {
        console.warn("Workspace launch measurement could not be stored", { code: error.code })
        return Response.json({ accepted: false }, { status: 202, headers: { "Cache-Control": "no-store" } })
    }
    return Response.json({ accepted: true }, { headers: { "Cache-Control": "no-store" } })
}
