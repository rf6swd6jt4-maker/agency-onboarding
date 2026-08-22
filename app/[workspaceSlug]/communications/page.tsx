import { CommunicationsPanel } from "@/components/communications/CommunicationsPanel"
import { WorkspaceTopBar } from "@/components/workspace/WorkspaceTopBar"
import { loadClientCommunicationsBootstrap } from "@/lib/communications/bootstrap"
import { requireWorkspace } from "@/lib/workspaces"
import { loadNativeCommunications } from "@/lib/teams/server"

export const dynamic = "force-dynamic"

type PageProps = {
    params: Promise<{ workspaceSlug: string }>
    searchParams: Promise<{ conversation?: string; mode?: string; nativeConversation?: string; dm?: string }>
}

export default async function CommunicationsPage({ params, searchParams }: PageProps) {
    const [{ workspaceSlug }, query] = await Promise.all([params, searchParams])
    const { workspace, user, role } = await requireWorkspace(workspaceSlug)
    const [bootstrap, nativeBootstrap] = await Promise.all([
        loadClientCommunicationsBootstrap({ currentUserId: user.id, requestedConversationId: query.conversation, workspaceId: workspace.id, workspaceSlug: workspace.slug }),
        loadNativeCommunications({ workspaceId: workspace.id, workspaceSlug: workspace.slug, currentUserId: user.id, role, requestedConversationId: query.nativeConversation, requestedDmUserId: query.dm }),
    ])

    return (
        <main className="fixed inset-0 overflow-hidden bg-black text-white">
            <WorkspaceTopBar userId={user.id} workspace={workspace} currentProduct="client-work" />
            <CommunicationsPanel clientBootstrap={bootstrap} nativeBootstrap={nativeBootstrap} initialMode={query.mode === "team" || (query.mode !== "clients" && (Boolean(query.dm) || Boolean(query.nativeConversation))) ? "team" : "clients"} />
        </main>
    )
}
