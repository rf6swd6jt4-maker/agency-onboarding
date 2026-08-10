import type { NextRequest } from "next/server"
import { loadVisualBuilderUpdates, persistVisualBuilderUpdate } from "@/lib/onboarding/builder-collaboration-server"

export const dynamic = "force-dynamic"

type RouteContext = { params: Promise<{ workspaceSlug: string }> }

export async function GET(request: NextRequest, { params }: RouteContext) {
    const { workspaceSlug } = await params
    const requested = Number(request.nextUrl.searchParams.get("after") ?? 0)
    const afterSequence = Number.isSafeInteger(requested) && requested >= 0 ? requested : 0
    const outcome = await loadVisualBuilderUpdates(workspaceSlug, afterSequence)
    return Response.json(outcome, { status: outcome.ok ? 200 : 400, headers: { "Cache-Control": "no-store" } })
}

export async function POST(request: NextRequest, { params }: RouteContext) {
    const { workspaceSlug } = await params
    const body = await request.json().catch(() => null) as {
        updateId?: unknown
        updateBase64?: unknown
        definitionIds?: unknown
    } | null
    const outcome = await persistVisualBuilderUpdate(
        workspaceSlug,
        typeof body?.updateId === "string" ? body.updateId : "",
        typeof body?.updateBase64 === "string" ? body.updateBase64 : "",
        Array.isArray(body?.definitionIds) ? body.definitionIds.filter((id): id is string => typeof id === "string") : [],
    )
    return Response.json(outcome, { status: outcome.ok ? 200 : 400, headers: { "Cache-Control": "no-store" } })
}
