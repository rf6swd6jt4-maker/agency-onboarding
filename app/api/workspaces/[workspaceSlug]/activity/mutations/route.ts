import type { NextRequest } from "next/server"

import { recordAdminActivity, type AdminActivityCategory } from "@/lib/admin/activity"
import { requireWorkspace } from "@/lib/workspaces"

export const dynamic = "force-dynamic"

const MUTATION_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"])
const CATEGORIES = new Set<AdminActivityCategory>(["onboarding", "services", "leadgen", "billing", "communications", "gantt", "integrations", "maintenance", "system"])

function text(value: unknown, maximum: number) {
    return typeof value === "string" ? value.trim().slice(0, maximum) : ""
}

export async function POST(request: NextRequest, context: { params: Promise<{ workspaceSlug: string }> }) {
    const { workspaceSlug } = await context.params
    const { workspace, user } = await requireWorkspace(workspaceSlug)
    const input = await request.json().catch(() => null) as Record<string, unknown> | null
    const method = text(input?.method, 10).toUpperCase()
    const path = text(input?.path, 300)
    const requestId = text(input?.requestId, 100)
    if (!MUTATION_METHODS.has(method) || !path.startsWith("/") || !requestId) {
        return Response.json({ error: "Invalid mutation activity" }, { status: 400 })
    }

    const categoryInput = text(input?.category, 40) as AdminActivityCategory
    const category = CATEGORIES.has(categoryInput) ? categoryInput : "system"
    const failed = input?.failed === true
    const aborted = input?.aborted === true
    const background = input?.background === true
    const status = Math.max(0, Math.min(599, Math.floor(Number(input?.status) || 0)))
    const durationMs = Math.max(0, Math.min(300_000, Math.round(Number(input?.durationMs) || 0)))
    const error = text(input?.error, 300)

    await recordAdminActivity({
        workspaceId: workspace.id,
        category,
        level: failed ? "error" : "info",
        eventKey: failed ? "workspace.mutation.failed" : aborted ? "workspace.mutation.aborted" : "workspace.mutation.completed",
        summary: failed ? "Workspace mutation failed" : aborted ? "Workspace mutation was cancelled" : "Workspace mutation completed",
        actorUserId: user.id,
        actorKind: "staff",
        sourceHref: path,
        metadata: { method, path, status, duration_ms: durationMs, background },
        diagnostics: failed ? { status, error } : {},
        correlationId: requestId,
        idempotencyKey: `workspace.mutation:${requestId}`,
        outcome: failed ? "failed" : aborted ? "skipped" : "succeeded",
        metricClassification: "operational",
    })

    return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } })
}
