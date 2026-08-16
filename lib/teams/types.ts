import type { ClientConversation, CommunicationAttachment, CommunicationPerson, CommunicationSticker } from "@/lib/communications/types"

export type WorkspaceTeamKind = "admins" | "maintenance" | "custom"

export type WorkspaceTeamResponsibility = {
    serviceId: string
    serviceName: string
    userId: string
}

export type WorkspaceTeam = {
    id: string
    name: string
    kind: WorkspaceTeamKind
    archivedAt: string | null
    memberIds: string[]
    responsibilities: WorkspaceTeamResponsibility[]
    maintenanceResponsibilities: Array<{ category: string; userId: string }>
}

export type NativeMessage = {
    id: string
    clientRequestId: string | null
    conversationId: string
    senderUserId: string
    body: string
    replyToMessageId: string | null
    attachment: CommunicationAttachment | null
    createdAt: string
}

export type NativeReaction = {
    id: string
    conversationId: string
    messageId: string
    reactorUserId: string
    emoji: string
    updatedAt: string
}

export type NativeReadCursor = {
    conversationId: string
    userId: string
    lastReadMessageId: string | null
    lastReadAt: string
}

export type NativeConversation = {
    id: string
    kind: "direct" | "team"
    teamId: string | null
    title: string
    subtitle: string
    avatarSrc: string | null
    memberIds: string[]
    archived: boolean
    canWrite: boolean
    updatedAt: string
    messages: NativeMessage[]
}

export type WorkspaceCommunicationConversation =
    | (ClientConversation & { kind: "client" })
    | NativeConversation

export type NativeCommunicationsBootstrap = {
    workspaceId: string
    workspaceSlug: string
    currentUser: CommunicationPerson
    people: CommunicationPerson[]
    conversations: NativeConversation[]
    teams: WorkspaceTeam[]
    reactions: NativeReaction[]
    readCursors: NativeReadCursor[]
    stickers: CommunicationSticker[]
    services: Array<{ id: string; name: string }>
    maintenanceCategories: Array<{ key: string; label: string }>
    canManageTeams: boolean
    isOwner: boolean
    requestedConversationId: string | null
    requestedDmUserId: string | null
    schemaReady: boolean
}
