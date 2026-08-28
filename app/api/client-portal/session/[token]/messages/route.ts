import { after, type NextRequest } from "next/server"

import { recordClientAdminActivity } from "@/lib/admin/activity"
import { loadClientPortalMessages } from "@/lib/client-portal/messages"
import { resolveClientPortalAccessByToken } from "@/lib/client-portal/session"
import { notifyClientChatMessage } from "@/lib/push/chat-notifications"
import { supabaseAdmin } from "@/lib/supabase/admin"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const MESSAGE_LIMIT = 4_000
const BURST_LIMIT = 20

function noStore(body: unknown, init?: ResponseInit) {
    const headers = new Headers(init?.headers)
    headers.set("Cache-Control", "private, no-store")
    return Response.json(body, { ...init, headers })
}

function publicMessage(input: {
    id: string
    body: string
    createdAt: string
}) {
    return {
        id: input.id,
        body: input.body,
        direction: "inbound" as const,
        senderKind: "client" as const,
        automationLabel: null,
        replyToMessageId: null,
        attachment: null,
        createdAt: input.createdAt,
    }
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

export async function POST(request: NextRequest, context: { params: Promise<{ token: string }> }) {
    const { token } = await context.params
    const resolved = await resolveClientPortalAccessByToken(token)
    if (!resolved) return noStore({ error: "Portal not found." }, { status: 404 })

    const input = await request.json().catch(() => null) as { body?: unknown; clientRequestId?: unknown } | null
    const body = typeof input?.body === "string" ? input.body.trim() : ""
    const clientRequestId = typeof input?.clientRequestId === "string" ? input.clientRequestId : ""
    if (!body || body.length > MESSAGE_LIMIT || !UUID_PATTERN.test(clientRequestId)) {
        return noStore({ error: `Write a message of up to ${MESSAGE_LIMIT.toLocaleString()} characters.` }, { status: 400 })
    }

    const existing = await supabaseAdmin
        .from("client_messages")
        .select("id, created_at")
        .eq("workspace_id", resolved.workspace.id)
        .eq("relationship_id", resolved.relationship.id)
        .eq("client_request_id", clientRequestId)
        .maybeSingle()
    if (existing.error) return noStore({ error: "Could not confirm this message." }, { status: 503 })
    if (existing.data) {
        return noStore({
            message: publicMessage({ id: existing.data.id, body, createdAt: existing.data.created_at }),
            reused: true,
        })
    }

    const since = new Date(Date.now() - 60_000).toISOString()
    const recent = await supabaseAdmin
        .from("client_messages")
        .select("id", { count: "exact", head: true })
        .eq("workspace_id", resolved.workspace.id)
        .eq("relationship_id", resolved.relationship.id)
        .eq("provider", "client_portal")
        .gte("created_at", since)
    if (recent.error) return noStore({ error: "Could not send this message right now." }, { status: 503 })
    if ((recent.count ?? 0) >= BURST_LIMIT) {
        return noStore({ error: "Please wait a moment before sending another message." }, { status: 429, headers: { "Retry-After": "30" } })
    }

    const created = await supabaseAdmin.from("client_messages").insert({
        workspace_id: resolved.workspace.id,
        relationship_id: resolved.relationship.id,
        client_id: resolved.relationship.client_id,
        direction: "inbound",
        provider: "client_portal",
        body,
        status: "received",
        sender_kind: "client",
        client_request_id: clientRequestId,
        raw_payload: {
            source: "client_portal",
            portal_session_id: resolved.session.id,
        },
    }).select("id, created_at").single()
    if (created.error || !created.data) {
        if (created.error?.code === "23505") return noStore({ error: "This message could not be confirmed. Please try again." }, { status: 409 })
        return noStore({ error: "Could not send this message right now." }, { status: 503 })
    }

    const message = publicMessage({ id: created.data.id, body, createdAt: created.data.created_at })
    after(async () => {
        await Promise.allSettled([
            notifyClientChatMessage({
                workspaceId: resolved.workspace.id,
                relationshipId: resolved.relationship.id,
                messageId: created.data.id,
                senderName: resolved.relationship.primary_person_name,
                previewBody: body,
            }),
            resolved.relationship.client_id
                ? recordClientAdminActivity({
                    clientId: resolved.relationship.client_id,
                    category: "communications",
                    eventKey: "client_portal.message.received",
                    summary: "Client portal message received",
                    entityType: "client_message",
                    entityId: created.data.id,
                    actorKind: "client",
                    direction: "inbound",
                    idempotencyKey: `client-portal-message:${created.data.id}`,
                    metadata: { source: "client_portal" },
                })
                : Promise.resolve(false),
        ])
    })
    return noStore({ message }, { status: 201 })
}
