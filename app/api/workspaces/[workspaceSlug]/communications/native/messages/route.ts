import { nativeAttachmentFromInput, nativeMessageFromRow, assertNativeConversationAccess } from "@/lib/teams/server"
import { verifyNativeMessageUpload } from "@/lib/onboarding/uploads"
import { supabaseAdmin } from "@/lib/supabase/admin"
import { requireWorkspace } from "@/lib/workspaces"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const COLUMNS = "id, client_request_id, conversation_id, sender_user_id, body, reply_to_message_id, attachment, created_at"

export async function GET(request: Request, context: { params: Promise<{ workspaceSlug: string }> }) {
    const { workspaceSlug } = await context.params
    const { workspace, user } = await requireWorkspace(workspaceSlug)
    const conversationId = new URL(request.url).searchParams.get("conversationId") ?? ""
    if (!await assertNativeConversationAccess(conversationId, user.id, "read")) return Response.json({ error: "Conversation not found." }, { status: 404 })
    const { data, error } = await supabaseAdmin.from("workspace_native_messages").select(COLUMNS).eq("workspace_id", workspace.id).eq("conversation_id", conversationId).order("created_at").limit(1000)
    if (error) return Response.json({ error: error.message }, { status: 503 })
    return Response.json({ messages: (data ?? []).flatMap((row) => nativeMessageFromRow(row) ?? []) })
}

export async function POST(request: Request, context: { params: Promise<{ workspaceSlug: string }> }) {
    const { workspaceSlug } = await context.params
    const { workspace, user } = await requireWorkspace(workspaceSlug)
    const input = await request.json().catch(() => null) as Record<string, unknown> | null
    const conversationId = typeof input?.conversationId === "string" ? input.conversationId : ""
    const clientRequestId = typeof input?.clientRequestId === "string" ? input.clientRequestId : ""
    const replyToMessageId = typeof input?.replyToMessageId === "string" ? input.replyToMessageId : ""
    const body = typeof input?.body === "string" ? input.body.trim() : ""
    const attachment = nativeAttachmentFromInput(input?.attachment)
    if (!UUID_PATTERN.test(conversationId) || !UUID_PATTERN.test(clientRequestId) || (replyToMessageId && !UUID_PATTERN.test(replyToMessageId)) || (!body && !attachment) || body.length > 8000 || (input?.attachment && !attachment)) return Response.json({ error: "A valid message or attachment is required." }, { status: 400 })
    if (!await assertNativeConversationAccess(conversationId, user.id, "write")) return Response.json({ error: "Conversation is unavailable or read-only." }, { status: 403 })
    const existing = await supabaseAdmin.from("workspace_native_messages").select(COLUMNS).eq("workspace_id", workspace.id).eq("client_request_id", clientRequestId).maybeSingle()
    if (existing.data) return Response.json({ message: nativeMessageFromRow(existing.data), reused: true })
    if (replyToMessageId) {
        const { data: replyTarget } = await supabaseAdmin.from("workspace_native_messages").select("id").eq("workspace_id", workspace.id).eq("conversation_id", conversationId).eq("id", replyToMessageId).maybeSingle()
        if (!replyTarget) return Response.json({ error: "The replied message was not found." }, { status: 404 })
    }
    let storedAttachment = attachment
    if (storedAttachment) {
        try {
            const verified = await verifyNativeMessageUpload({ workspaceId: workspace.id, conversationId, storagePath: storedAttachment.storagePath, mimeType: storedAttachment.mimeType })
            storedAttachment = { ...storedAttachment, kind: verified.kind, mimeType: verified.contentType, size: verified.size }
        } catch (error) {
            return Response.json({ error: error instanceof Error ? error.message : "Could not verify attachment." }, { status: 400 })
        }
    }
    const { data, error } = await supabaseAdmin.from("workspace_native_messages").insert({ workspace_id: workspace.id, conversation_id: conversationId, sender_user_id: user.id, client_request_id: clientRequestId, body, reply_to_message_id: replyToMessageId || null, attachment: storedAttachment }).select(COLUMNS).single()
    if (error) return Response.json({ error: error.message }, { status: 503 })
    return Response.json({ message: nativeMessageFromRow(data) })
}
