import { loadCommunicationMessages, loadCommunicationPeople, loadCommunicationReactions, loadCommunicationReadCursors, loadCommunicationStickers } from "@/lib/communications/server"
import type { ClientConversation, CommunicationsBootstrap } from "@/lib/communications/types"
import { listRelationshipsForWorkspace } from "@/lib/relationships"
import { supabaseAdmin } from "@/lib/supabase/admin"

export async function loadClientCommunicationsBootstrap({ currentUserId, requestedConversationId, workspaceId, workspaceSlug }: {
    currentUserId: string
    requestedConversationId?: string | null
    workspaceId: string
    workspaceSlug: string
}): Promise<CommunicationsBootstrap> {
    const relationships = (await listRelationshipsForWorkspace(workspaceId)).filter((relationship) => relationship.status !== "archived")
    const clientIds = relationships.flatMap((relationship) => relationship.client_id ? [relationship.client_id] : [])
    const [messageResult, cursorResult, reactionResult, stickerResult, peopleResult, channelResult, integrationResult, selectedMessages] = await Promise.all([
        loadCommunicationMessages({ workspaceId }),
        loadCommunicationReadCursors(workspaceId),
        loadCommunicationReactions(workspaceId),
        loadCommunicationStickers(workspaceId),
        loadCommunicationPeople(workspaceId, currentUserId),
        clientIds.length
            ? supabaseAdmin.from("client_communication_channels").select("client_id, provider").eq("workspace_id", workspaceId).in("provider", ["meta_whatsapp", "twilio_sms"]).eq("is_active", true).in("client_id", clientIds)
            : Promise.resolve({ data: [], error: null }),
        supabaseAdmin.from("workspace_integrations").select("provider").eq("workspace_id", workspaceId).eq("enabled", true).in("provider", ["meta_whatsapp", "twilio_sms"]),
        requestedConversationId && relationships.some((relationship) => relationship.id === requestedConversationId)
            ? loadCommunicationMessages({ workspaceId, relationshipId: requestedConversationId, limit: 500 })
            : Promise.resolve(null),
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
        messages: relationship.id === requestedConversationId && selectedMessages ? selectedMessages.messages : messagesByRelationship.get(relationship.id) ?? [],
        messageWindowStart: relationship.id === requestedConversationId && selectedMessages
            ? selectedMessages.messages.length >= 500 ? selectedMessages.messages[0]?.createdAt : null
            : messageResult.messages[0]?.createdAt ?? null,
    })).sort((left, right) => {
        const leftDate = left.messages.at(-1)?.createdAt ?? ""
        const rightDate = right.messages.at(-1)?.createdAt ?? ""
        return rightDate.localeCompare(leftDate) || left.title.localeCompare(right.title)
    })
    return {
        workspaceId,
        workspaceSlug,
        currentUser: peopleResult.currentUser,
        people: peopleResult.people,
        conversations,
        readCursors: cursorResult.cursors,
        reactions: reactionResult.reactions,
        stickers: stickerResult.stickers,
        selectedConversationId: conversations.some((conversation) => conversation.id === requestedConversationId) ? requestedConversationId ?? null : null,
        schemaReady: messageResult.schemaReady && cursorResult.schemaReady && reactionResult.schemaReady && stickerResult.schemaReady,
    }
}
