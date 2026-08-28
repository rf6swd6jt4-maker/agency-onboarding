import type { NextRequest } from "next/server"

import { loadClientPortalMessages } from "@/lib/client-portal/messages"
import { resolveClientPortalAccessByToken } from "@/lib/client-portal/session"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function noStore(body: unknown, init?: ResponseInit) {
    const headers = new Headers(init?.headers)
    headers.set("Cache-Control", "private, no-store")
    return Response.json(body, { ...init, headers })
}

export async function GET(request: NextRequest, context: { params: Promise<{ token: string }> }) {
    const { token } = await context.params
    const resolved = await resolveClientPortalAccessByToken(token)
    if (!resolved) return noStore({ error: "Portal not found." }, { status: 404 })

    const beforeInput = request.nextUrl.searchParams.get("before")
    const before = beforeInput && !Number.isNaN(Date.parse(beforeInput)) ? new Date(beforeInput).toISOString() : null
    const requestedLimit = Number(request.nextUrl.searchParams.get("limit") ?? 100)
    const limit = Number.isFinite(requestedLimit) ? Math.max(1, Math.min(200, Math.round(requestedLimit))) : 100

    try {
        const messages = await loadClientPortalMessages({
            workspaceId: resolved.workspace.id,
            relationshipId: resolved.relationship.id,
            before,
            limit,
        })
        return noStore({
            messages: messages.map((message) => ({
                ...message,
                attachment: message.attachment ? {
                    kind: message.attachment.kind,
                    fileName: message.attachment.fileName,
                    mimeType: message.attachment.mimeType,
                    size: message.attachment.size,
                } : null,
            })),
            nextBefore: messages.length === limit ? messages[0]?.createdAt ?? null : null,
        })
    } catch {
        return noStore({ error: "Messages are temporarily unavailable." }, { status: 503 })
    }
}
