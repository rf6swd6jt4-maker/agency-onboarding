type ReadCursor = {
    lastReadMessageId: string | null
    lastReadAt: string
}

type ClientUnreadConversation = {
    messages: Array<{ id: string; direction: "inbound" | "outbound"; createdAt: string }>
}

type NativeUnreadConversation = {
    messages: Array<{ id: string; senderUserId: string; createdAt: string }>
}

export function clientConversationUnreadCount(
    conversation: ClientUnreadConversation,
    ownCursor: ReadCursor | undefined,
    visiblyReading: boolean
) {
    if (visiblyReading) return 0
    const cursorIndex = ownCursor?.lastReadMessageId
        ? conversation.messages.findIndex((message) => message.id === ownCursor.lastReadMessageId)
        : -1
    return conversation.messages.filter((message, index) => message.direction === "inbound"
        && (cursorIndex >= 0 ? index > cursorIndex : !ownCursor || message.createdAt > ownCursor.lastReadAt)).length
}

export function nativeConversationUnreadCount(
    conversation: NativeUnreadConversation,
    ownCursor: ReadCursor | undefined,
    currentUserId: string,
    visiblyReading: boolean
) {
    if (visiblyReading) return 0
    const cursorIndex = ownCursor?.lastReadMessageId
        ? conversation.messages.findIndex((message) => message.id === ownCursor.lastReadMessageId)
        : -1
    return conversation.messages.filter((message, index) => message.senderUserId !== currentUserId
        && (cursorIndex >= 0 ? index > cursorIndex : !ownCursor || message.createdAt > ownCursor.lastReadAt)).length
}
