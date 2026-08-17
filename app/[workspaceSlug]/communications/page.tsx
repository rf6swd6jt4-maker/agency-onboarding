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
    const [messageResult, cursorResult, reactionResult, stickerResult, peopleResult, channelResult, integrationResult, nativeBootstrap] = await Promise.all([
        loadCommunicationMessages({ workspaceId: workspace.id }),
        loadCommunicationReadCursors(workspace.id),
        loadCommunicationReactions(workspace.id),
        loadCommunicationStickers(workspace.id),
        loadCommunicationPeople(workspace.id, user.id),
        clientIds.length
            ? supabaseAdmin.from("client_communication_channels").select("client_id, provider").eq("workspace_id", workspace.id).in("provider", ["meta_whatsapp", "twilio_sms"]).eq("is_active", true).in("client_id", clientIds)
            : Promise.resolve({ data: [], error: null }),
        supabaseAdmin.from("workspace_integrations").select("provider").eq("workspace_id", workspace.id).eq("enabled", true).in("provider", ["meta_whatsapp", "twilio_sms"]),
        loadNativeCommunications({ workspaceId: workspace.id, workspaceSlug: workspace.slug, currentUserId: user.id, role, requestedConversationId: query.nativeConversation, requestedDmUserId: query.dm }),
    ])
    const channelsByClient = new Map<string, Set<string>>()
    for (const channel of channelResult.data ?? []) {
        const providers = channelsByClient.get(channel.client_id) ?? new Set<string>()
        providers.add(channel.provider)
        channelsByClient.set(channel.client_id, providers)
    }
    const connectedProviders = new Set((integrationResult.data ?? []).map((integration) => integration.provider))
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
        canSend: Boolean(
            (connectedProviders.has("twilio_sms") && relationship.primary_phone)
            || (connectedProviders.has("meta_whatsapp") && (relationship.whatsapp_phone || relationship.primary_phone))
            || (relationship.client_id && channelsByClient.get(relationship.client_id)?.size)
        ),
        channels: ([
            connectedProviders.has("meta_whatsapp") && (relationship.whatsapp_phone || relationship.primary_phone) ? "meta_whatsapp" : null,
            connectedProviders.has("twilio_sms") && relationship.primary_phone ? "twilio_sms" : null,
        ].filter(Boolean) as Array<"meta_whatsapp" | "twilio_sms">),
        primaryProvider: (relationship.communication_primary_provider === "twilio_sms" ? "twilio_sms" : "meta_whatsapp") as "twilio_sms" | "meta_whatsapp",
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
