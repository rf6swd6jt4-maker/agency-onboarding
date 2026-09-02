import { assertNativeConversationAccess } from "@/lib/teams/server"
import { createSignedNativeMessageUpload, deleteOnboardingUploads } from "@/lib/onboarding/uploads"
import { ensurePlatformDirectUploads } from "@/lib/onboarding/r2-cors"
import { requireWorkspacePanel } from "@/lib/workspace-access"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(request: Request, context: { params: Promise<{ workspaceSlug: string }> }) {
    const { workspaceSlug } = await context.params
    const { workspace, user } = await requireWorkspacePanel(workspaceSlug, "communications")
    const input = await request.json().catch(() => null) as Record<string, unknown> | null
    const conversationId = typeof input?.conversationId === "string" ? input.conversationId : ""
    if (!await assertNativeConversationAccess(conversationId, user.id, "write")) return Response.json({ error: "Conversation is unavailable or read-only." }, { status: 403 })
    try {
        await ensurePlatformDirectUploads()
        return Response.json(await createSignedNativeMessageUpload(workspace.id, conversationId, { name: typeof input?.name === "string" ? input.name : "", size: Number(input?.size ?? 0), type: typeof input?.type === "string" ? input.type : "application/octet-stream" }))
    } catch (error) {
        return Response.json({ error: error instanceof Error ? error.message : "Could not prepare attachment." }, { status: 400 })
    }
}

export async function DELETE(request: Request, context: { params: Promise<{ workspaceSlug: string }> }) {
    const { workspaceSlug } = await context.params
    const { workspace, user } = await requireWorkspacePanel(workspaceSlug, "communications")
    const input = await request.json().catch(() => null) as Record<string, unknown> | null
    const conversationId = typeof input?.conversationId === "string" ? input.conversationId : ""
    const storagePath = typeof input?.storagePath === "string" ? input.storagePath : ""
    const prefix = `${workspace.id}/communications/native/${conversationId}/`
    if (!await assertNativeConversationAccess(conversationId, user.id, "write") || !storagePath.startsWith(prefix) || storagePath.slice(prefix.length).includes("/")) return Response.json({ error: "Attachment not found." }, { status: 404 })
    await deleteOnboardingUploads([storagePath])
    return Response.json({ ok: true })
}
