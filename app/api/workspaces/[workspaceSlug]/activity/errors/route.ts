import type { NextRequest } from "next/server"
import { platformFailureFingerprint, reportPlatformFailure } from "@/lib/admin/maintenance"
import { requireWorkspace } from "@/lib/workspaces"

export const dynamic = "force-dynamic"

type RouteContext = { params: Promise<{ workspaceSlug: string }> }

function cleanText(value: unknown, fallback: string, maxLength: number) {
    return typeof value === "string" && value.trim() ? value.trim().slice(0, maxLength) : fallback
}

export async function POST(request: NextRequest, { params }: RouteContext) {
    const { workspaceSlug } = await params
    const { workspace, user } = await requireWorkspace(workspaceSlug)
    const body = await request.json().catch(() => ({})) as Record<string, unknown>
    const boundary = body.boundary === "global" ? "global" : "app"
    const digest = cleanText(body.digest, "unexpected", 120)
    const message = cleanText(body.message, "Unexpected application error", 500)
    const requestedPath = cleanText(body.path, `/${workspace.slug}`, 500)
    const sourceHref = requestedPath.startsWith(`/${workspace.slug}`) ? requestedPath : `/${workspace.slug}`
    const result = await reportPlatformFailure({
        workspaceId: workspace.id,
        category: "system_health",
        source: "next_error_boundary",
        operation: boundary,
        fingerprint: platformFailureFingerprint(["ui", boundary, digest, sourceHref.split("?")[0]]),
        severity: "warning",
        summary: `A workspace user was shown the ${boundary === "global" ? "global" : "workspace"} error screen`,
        diagnostics: { digest, message, path: sourceHref, reported_by: user.id },
        sourceHref,
    })
    return Response.json({ ok: result.ok }, { status: result.ok ? 202 : 503 })
}
