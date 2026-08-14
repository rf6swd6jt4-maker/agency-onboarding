export type CommunicationSenderKind = "client" | "staff" | "automation" | "legacy"

export type CommunicationMessage = {
    id: string
    clientRequestId: string | null
    relationshipId: string
    body: string
    direction: "inbound" | "outbound"
    provider: string
    status: string
    error: string | null
    senderKind: CommunicationSenderKind
    senderUserId: string | null
    automationKind: string | null
    automationLabel: string | null
    createdAt: string
    sentAt: string | null
    deliveredAt: string | null
    readAt: string | null
    failedAt: string | null
}

export type CommunicationPerson = {
    id: string
    name: string
    avatarSrc: string | null
}

export type CommunicationReadCursor = {
    relationshipId: string
    userId: string
    lastReadMessageId: string | null
    lastReadAt: string
}

export type ClientConversation = {
    id: string
    clientId: string | null
    title: string
    subtitle: string | null
    canSend: boolean
    messages: CommunicationMessage[]
}

export type CommunicationsBootstrap = {
    workspaceId: string
    workspaceSlug: string
    workspaceName: string
    currentUser: CommunicationPerson
    people: CommunicationPerson[]
    conversations: ClientConversation[]
    readCursors: CommunicationReadCursor[]
    selectedConversationId: string | null
    schemaReady: boolean
}
