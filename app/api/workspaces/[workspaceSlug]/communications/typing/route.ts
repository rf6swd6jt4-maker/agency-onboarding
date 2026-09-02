import { NextRequest } from "next/server"

import { sendMetaWhatsAppTypingIndicator } from "@/lib/client-messages/meta-whatsapp"
import { supabaseAdmin } from "@/lib/supabase/admin"
import { requireWorkspacePanel } from "@/lib/workspace-access"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export async function POST(request: NextRequest, context: { params: Promise<{ workspaceSlug: string }> }) {
    const { workspaceSlug } = await context.params
    const { workspace } = await requireWorkspacePanel(workspaceSlug, "communications")
    const input = await request.json().catch(() => null) as { relationshipId?: unknown } | null
    const relationshipId = typeof input?.relationshipId === "string" ? input.relationshipId : ""
    if (!UUID_PATTERN.test(relationshipId)) return Response.json({ error: "Invalid conversation" }, { status: 400 })

    const relationship = await supabaseAdmin
        .from("relationships")
        .select("id, status")
        .eq("workspace_id", workspace.id)
        .eq("id", relationshipId)
        .maybeSingle()
    if (relationship.error) return Response.json({ error: relationship.error.message }, { status: 503 })
    if (!relationship.data || relationship.data.status === "archived") return Response.json({ error: "Conversation not found" }, { status: 404 })

    const latestInbound = await supabaseAdmin
        .from("client_messages")
        .select("provider_message_id, whatsapp_message_id")
        .eq("workspace_id", workspace.id)
        .eq("relationship_id", relationshipId)
        .eq("direction", "inbound")
        .eq("provider", "meta_whatsapp")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle()
    if (latestInbound.error) return Response.json({ error: latestInbound.error.message }, { status: 503 })
    const messageId = latestInbound.data?.whatsapp_message_id ?? latestInbound.data?.provider_message_id ?? null
    if (!messageId) return Response.json({ sent: false })

    try {
        await sendMetaWhatsAppTypingIndicator({ workspaceId: workspace.id, messageId })
        return Response.json({ sent: true })
    } catch (error) {
        return Response.json({ error: error instanceof Error ? error.message : "Could not send the WhatsApp typing indicator." }, { status: 502 })
    }
}
