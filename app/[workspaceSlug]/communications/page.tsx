import { WorkspaceBanner } from "@/components/admin/WorkspaceBanner"
import { CommunicationsWorkspace, type ClientConversation, type CommunicationMessage } from "@/components/communications/CommunicationsWorkspace"
import { PanelTabHeader } from "@/components/panel/PanelTabHeader"
import { PanelTabs } from "@/components/panel/PanelTabs"
import { WorkspaceTopBar } from "@/components/workspace/WorkspaceTopBar"
import { listRelationshipsForWorkspace, workspaceHref } from "@/lib/relationships"
import { supabaseAdmin } from "@/lib/supabase/admin"
import { requireWorkspace } from "@/lib/workspaces"

export const dynamic = "force-dynamic"

type PageProps = {
    params: Promise<{ workspaceSlug: string }>
    searchParams: Promise<{ area?: string; conversation?: string }>
}

export default async function CommunicationsPage({ params, searchParams }: PageProps) {
    const [{ workspaceSlug }, query] = await Promise.all([params, searchParams])
    const { workspace, user } = await requireWorkspace(workspaceSlug)
    const relationships = (await listRelationshipsForWorkspace(workspace.id)).filter((relationship) => relationship.status !== "archived")
    const clientIds = relationships.map((relationship) => relationship.client_id).filter((id): id is string => Boolean(id))
    const { data: messages } = clientIds.length
        ? await supabaseAdmin
            .from("client_messages")
            .select("id, client_id, body, direction, provider, status, created_at")
            .in("client_id", clientIds)
            .order("created_at", { ascending: false })
            .limit(500)
        : { data: [] }
    const messagesByClient = new Map<string, CommunicationMessage[]>()
    for (const message of messages ?? []) {
        const existing = messagesByClient.get(message.client_id) ?? []
        existing.push(message)
        messagesByClient.set(message.client_id, existing)
    }

    const conversations: ClientConversation[] = relationships
        .flatMap((relationship) => {
            const clientMessages = relationship.client_id ? messagesByClient.get(relationship.client_id) ?? [] : []
            if (!clientMessages.length) return []
            return [{
                id: relationship.id,
                title: relationship.business_name
                    ? `${relationship.primary_person_name} – ${relationship.business_name}`
                    : relationship.primary_person_name,
                subtitle: relationship.primary_email ?? relationship.whatsapp_phone ?? relationship.primary_phone,
                messages: [...clientMessages].reverse(),
            }]
        })
        .sort((left, right) => right.messages.at(-1)!.created_at.localeCompare(left.messages.at(-1)!.created_at))
    const activeArea = query.area === "team" || query.area === "calendar" ? query.area : "clients"
    const selectedConversationId = conversations.some((conversation) => conversation.id === query.conversation) ? query.conversation ?? null : null
    const tabs = [
        { key: "clients", label: "Clients", href: workspaceHref(workspace.slug, "communications?area=clients") },
        { key: "team", label: "Team", href: workspaceHref(workspace.slug, "communications?area=team") },
        { key: "calendar", label: "Calendar", href: workspaceHref(workspace.slug, "communications?area=calendar") },
    ] as const

    return (
        <main className="min-h-screen bg-neutral-950 px-4 pb-7 text-white sm:px-6">
            <WorkspaceTopBar userId={user.id} workspace={workspace} currentProduct="client-work" />
            <div className="mx-auto max-w-7xl pt-5">
                <WorkspaceBanner bannerPath={workspace.banner_path} logoPath={workspace.logo_path} name={workspace.name} height={workspace.banner_height} position={workspace.banner_position} />
                <PanelTabHeader
                    title="Communications"
                    description="Client conversations, team communication, and meetings in one workspace."
                    tabs={<PanelTabs items={tabs} active={activeArea} ariaLabel="Communications workspace" />}
                />
                <CommunicationsWorkspace workspaceSlug={workspace.slug} activeArea={activeArea} conversations={conversations} selectedConversationId={selectedConversationId} />
            </div>
        </main>
    )
}
