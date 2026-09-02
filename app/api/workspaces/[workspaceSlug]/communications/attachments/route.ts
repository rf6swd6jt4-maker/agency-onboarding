import { NextRequest } from "next/server"

import { deleteOnboardingUploads, createSignedClientMessageUpload } from "@/lib/onboarding/uploads"
import { ensurePlatformDirectUploads } from "@/lib/onboarding/r2-cors"
import { supabaseAdmin } from "@/lib/supabase/admin"
import { requireWorkspacePanel } from "@/lib/workspace-access"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

async function activeRelationship(workspaceId: string, relationshipId: string) {
    if (!UUID_PATTERN.test(relationshipId)) return null
    const { data, error } = await supabaseAdmin
        .from("relationships")
        .select("id, status")
        .eq("workspace_id", workspaceId)
        .eq("id", relationshipId)
        .maybeSingle()
    if (error) throw new Error(error.message)
    return data?.status === "archived" ? null : data
}

export async function POST(request: NextRequest, context: { params: Promise<{ workspaceSlug: string }> }) {
    const { workspaceSlug } = await context.params
    const { workspace } = await requireWorkspacePanel(workspaceSlug, "communications")
    const input = await request.json().catch(() => null) as {
        relationshipId?: unknown
        name?: unknown
        size?: unknown
        type?: unknown
    } | null
    const relationshipId = typeof input?.relationshipId === "string" ? input.relationshipId : ""
    if (!await activeRelationship(workspace.id, relationshipId)) {
        return Response.json({ error: "Conversation not found." }, { status: 404 })
    }
    const file = {
        name: typeof input?.name === "string" ? input.name : "",
        size: typeof input?.size === "number" ? input.size : Number(input?.size ?? 0),
        type: typeof input?.type === "string" ? input.type : "application/octet-stream",
    }
    try {
        await ensurePlatformDirectUploads()
        return Response.json(await createSignedClientMessageUpload(workspace.id, relationshipId, file))
    } catch (error) {
        return Response.json({ error: error instanceof Error ? error.message : "Could not prepare attachment upload." }, { status: 400 })
    }
}

export async function DELETE(request: NextRequest, context: { params: Promise<{ workspaceSlug: string }> }) {
    const { workspaceSlug } = await context.params
    const { workspace } = await requireWorkspacePanel(workspaceSlug, "communications")
    const input = await request.json().catch(() => null) as { relationshipId?: unknown; storagePath?: unknown } | null
    const relationshipId = typeof input?.relationshipId === "string" ? input.relationshipId : ""
    const storagePath = typeof input?.storagePath === "string" ? input.storagePath : ""
    const prefix = `${workspace.id}/relationships/${relationshipId}/client-messages/`
    if (!await activeRelationship(workspace.id, relationshipId) || !storagePath.startsWith(prefix) || storagePath.slice(prefix.length).includes("/")) {
        return Response.json({ error: "Attachment not found." }, { status: 404 })
    }
    await deleteOnboardingUploads([storagePath])
    return Response.json({ ok: true })
}
