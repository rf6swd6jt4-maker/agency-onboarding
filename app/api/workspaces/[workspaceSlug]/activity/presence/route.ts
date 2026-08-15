import type { NextRequest } from "next/server"

import { recordAdminActivity } from "@/lib/admin/activity"
import { requireWorkspace } from "@/lib/workspaces"

export const dynamic = "force-dynamic"

const STATES = new Set(["reconnecting", "offline", "error"])

function text(value: unknown, maximum: number) {
    return typeof value === "string" ? value.trim().slice(0, maximum) : ""
}

export async function POST(request: NextRequest, context: { params: Promise<{ workspaceSlug: string }> }) {
    const { workspaceSlug } = await context.params
    const { workspace, user } = await requireWorkspace(workspaceSlug)
    const input = await request.json().catch(() => null) as Record<string, unknown> | null
    const state = text(input?.state, 20)
    const sessionId = text(input?.sessionId, 100)
    const error = text(input?.error, 300)
    if (!STATES.has(state) || !sessionId) return Response.json({ error: "Invalid presence diagnostic" }, { status: 400 })

    const minute = new Date().toISOString().slice(0, 16)
    await recordAdminActivity({
        workspaceId: workspace.id,
        category: "system",
        level: state === "error" ? "error" : "warning",
        eventKey: `workspace.presence.${state}`,
        summary: `Workspace presence ${state}`,
        actorUserId: user.id,
        actorKind: "staff",
        diagnostics: error ? { error } : {},
        metadata: { state },
        correlationId: sessionId,
        idempotencyKey: `workspace.presence:${user.id}:${sessionId}:${state}:${minute}`,
        outcome: state === "error" ? "failed" : "skipped",
        metricClassification: "audit",
    })

    return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } })
}
