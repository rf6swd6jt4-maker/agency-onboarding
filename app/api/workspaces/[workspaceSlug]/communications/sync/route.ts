import { loadClientCommunicationsBootstrap } from "@/lib/communications/bootstrap"
import { requireWorkspacePanel } from "@/lib/workspace-access"

export const dynamic = "force-dynamic"

export async function GET(request: Request, context: { params: Promise<{ workspaceSlug: string }> }) {
    const { workspaceSlug } = await context.params
    const { workspace, user } = await requireWorkspacePanel(workspaceSlug, "communications")
    const bootstrap = await loadClientCommunicationsBootstrap({
        currentUserId: user.id,
        requestedConversationId: new URL(request.url).searchParams.get("conversation"),
        workspaceId: workspace.id,
        workspaceSlug: workspace.slug,
    })
    return Response.json(bootstrap, { headers: { "Cache-Control": "no-store" } })
}
