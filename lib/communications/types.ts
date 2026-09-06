export type CommunicationSenderKind = "client" | "staff" | "automation" | "legacy"

export type CommunicationAttachment = {
    kind: "image" | "video" | "audio" | "document" | "sticker"
    fileName: string
    mimeType: string
    size: number | null
    storagePath: string
    url: string
    width?: number
    height?: number
    duration?: number
    hasPreview?: boolean
}

export type CommunicationReaction = {
    id: string
    relationshipId: string
    messageId: string
    direction: "inbound" | "outbound"
    emoji: string
    reactorUserId: string | null
    updatedAt: string
}

export type CommunicationDelivery = {
    provider: "meta_whatsapp" | "twilio_sms"
    providerMessageId: string | null
    status: string
    error: string | null
    sentAt: string | null
    deliveredAt: string | null
    readAt: string | null
    failedAt: string | null
}

export type CommunicationSticker = {
    id: string
    fileName: string
    storagePath: string
    size: number
    url: string
    createdAt: string
}

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
    attachment: CommunicationAttachment | null
    providerMessageId: string | null
    replyToProviderMessageId: string | null
    replyToMessageId?: string | null
    deliveries?: CommunicationDelivery[]
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
    former?: boolean
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
    isTest: boolean
    canSend: boolean
    channels?: Array<"meta_whatsapp" | "twilio_sms">
    primaryProvider?: "meta_whatsapp" | "twilio_sms"
    pinnedMessageId: string | null
    messages: CommunicationMessage[]
    messageWindowStart?: string | null
}

export type CommunicationsBootstrap = {
    workspaceId: string
    workspaceSlug: string
    currentUser: CommunicationPerson
    people: CommunicationPerson[]
    conversations: ClientConversation[]
    readCursors: CommunicationReadCursor[]
    reactions: CommunicationReaction[]
    stickers: CommunicationSticker[]
    selectedConversationId: string | null
    schemaReady: boolean
}
