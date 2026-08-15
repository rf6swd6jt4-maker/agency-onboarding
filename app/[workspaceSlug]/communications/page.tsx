import { CommunicationsWorkspace } from "@/components/communications/CommunicationsWorkspace"
import { WorkspaceTopBar } from "@/components/workspace/WorkspaceTopBar"
import { loadCommunicationMessages, loadCommunicationPeople, loadCommunicationReactions, loadCommunicationReadCursors, loadCommunicationStickers } from "@/lib/communications/server"
import type { ClientConversation, CommunicationsBootstrap } from "@/lib/communications/types"
import { listRelationshipsForWorkspace } from "@/lib/relationships"
import { supabaseAdmin } from "@/lib/supabase/admin"
import { requireWorkspace } from "@/lib/workspaces"

export const dynamic = "force-dynamic"

type PageProps = {
    params: Promise<{ workspaceSlug: string }>
    searchParams: Promise<{ conversation?: string }>
}

export default async function CommunicationsPage({ params, searchParams }: PageProps) {
    const [{ workspaceSlug }, query] = await Promise.all([params, searchParams])
    const { workspace, user } = await requireWorkspace(workspaceSlug)
    const relationships = (await listRelationshipsForWorkspace(workspace.id)).filter((relationship) => relationship.status !== "archived")
    const clientIds = relationships.flatMap((relationship) => relationship.client_id ? [relationship.client_id] : [])
    const [messageResult, cursorResult, reactionResult, stickerResult, peopleResult, channelResult] = await Promise.all([
        loadCommunicationMessages({ workspaceId: workspace.id }),
        loadCommunicationReadCursors(workspace.id),
        loadCommunicationReactions(workspace.id),
        loadCommunicationStickers(workspace.id),
        loadCommunicationPeople(workspace.id, user.id),
        clientIds.length
            ? supabaseAdmin.from("client_communication_channels").select("client_id").eq("workspace_id", workspace.id).eq("provider", "meta_whatsapp").eq("is_active", true).in("client_id", clientIds)
            : Promise.resolve({ data: [], error: null }),
    ])
    const channelClientIds = new Set((channelResult.data ?? []).map((channel) => channel.client_id))
    const messagesByRelationship = new Map<string, typeof messageResult.messages>()
    for (const message of messageResult.messages) {
        const existing = messagesByRelationship.get(message.relationshipId) ?? []
        existing.push(message)
        messagesByRelationship.set(message.relationshipId, existing)
    }
    const conversations: ClientConversation[] = relationships.map((relationship) => ({
        id: relationship.id,
        clientId: relationship.client_id,
        title: relationship.business_name ? `${relationship.primary_person_name} – ${relationship.business_name}` : relationship.primary_person_name,
        subtitle: relationship.whatsapp_phone ?? relationship.primary_phone ?? relationship.primary_email,
        canSend: Boolean((relationship.client_id && channelClientIds.has(relationship.client_id)) || relationship.whatsapp_phone || relationship.primary_phone),
        messages: messagesByRelationship.get(relationship.id) ?? [],
    })).sort((left, right) => {
        const leftDate = left.messages.at(-1)?.createdAt ?? ""
        const rightDate = right.messages.at(-1)?.createdAt ?? ""
        return rightDate.localeCompare(leftDate) || left.title.localeCompare(right.title)
    })
    const bootstrap: CommunicationsBootstrap = {
        workspaceId: workspace.id,
        workspaceSlug: workspace.slug,
        currentUser: peopleResult.currentUser,
        people: peopleResult.people,
        conversations,
        readCursors: cursorResult.cursors,
        reactions: reactionResult.reactions,
        stickers: stickerResult.stickers,
        selectedConversationId: conversations.some((conversation) => conversation.id === query.conversation) ? query.conversation ?? null : null,
        schemaReady: messageResult.schemaReady && cursorResult.schemaReady && reactionResult.schemaReady && stickerResult.schemaReady,
    }

    return (
        <main className="h-dvh overflow-hidden bg-neutral-950 text-white">
            <WorkspaceTopBar userId={user.id} workspace={workspace} currentProduct="client-work" />
            <CommunicationsWorkspace bootstrap={bootstrap} />
        </main>
    )
}
