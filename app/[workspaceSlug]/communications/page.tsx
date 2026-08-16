import { CommunicationsPanel } from "@/components/communications/CommunicationsPanel"
import { WorkspaceTopBar } from "@/components/workspace/WorkspaceTopBar"
import { loadCommunicationMessages, loadCommunicationPeople, loadCommunicationReactions, loadCommunicationReadCursors, loadCommunicationStickers } from "@/lib/communications/server"
import type { ClientConversation, CommunicationsBootstrap } from "@/lib/communications/types"
import { listRelationshipsForWorkspace } from "@/lib/relationships"
import { supabaseAdmin } from "@/lib/supabase/admin"
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
    const relationships = (await listRelationshipsForWorkspace(workspace.id)).filter((relationship) => relationship.status !== "archived")
    const clientIds = relationships.flatMap((relationship) => relationship.client_id ? [relationship.client_id] : [])
    const [messageResult, cursorResult, reactionResult, stickerResult, peopleResult, channelResult, nativeBootstrap] = await Promise.all([
        loadCommunicationMessages({ workspaceId: workspace.id }),
        loadCommunicationReadCursors(workspace.id),
        loadCommunicationReactions(workspace.id),
        loadCommunicationStickers(workspace.id),
        loadCommunicationPeople(workspace.id, user.id),
        clientIds.length
            ? supabaseAdmin.from("client_communication_channels").select("client_id").eq("workspace_id", workspace.id).eq("provider", "meta_whatsapp").eq("is_active", true).in("client_id", clientIds)
            : Promise.resolve({ data: [], error: null }),
        loadNativeCommunications({ workspaceId: workspace.id, workspaceSlug: workspace.slug, currentUserId: user.id, role, requestedConversationId: query.nativeConversation, requestedDmUserId: query.dm }),
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
        isTest: relationship.source_metadata.is_test === true,
        canSend: Boolean((relationship.client_id && channelClientIds.has(relationship.client_id)) || relationship.whatsapp_phone || relationship.primary_phone),
        pinnedMessageId: relationship.communication_pinned_message_id,
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
        <main className="fixed inset-0 overflow-hidden bg-black text-white">
            <WorkspaceTopBar userId={user.id} workspace={workspace} currentProduct="client-work" />
            <CommunicationsPanel clientBootstrap={bootstrap} nativeBootstrap={nativeBootstrap} initialMode={query.mode === "team" || Boolean(query.dm) || Boolean(query.nativeConversation) ? "team" : "clients"} />
        </main>
    )
}
