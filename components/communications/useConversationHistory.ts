"use client"

import { useState } from "react"

const PAGE_SIZE = 60
type Message = { id: string; clientRequestId: string | null }
const key = (message: Message) => message.clientRequestId ?? message.id

/** Expand upward without evicting mounted messages as new messages arrive. */
export function useConversationHistory(conversationId: string | null, messages: Message[]) {
    const firstKey = () => messages.length ? key(messages[Math.max(0, messages.length - PAGE_SIZE)]) : null
    const [window, setWindow] = useState(() => ({ conversationId, first: firstKey() }))
    if (window.conversationId !== conversationId || (!window.first && messages.length)) setWindow({ conversationId, first: firstKey() })
    const index = window.conversationId === conversationId && window.first ? messages.findIndex((message) => key(message) === window.first) : -1
    const startIndex = index < 0 ? Math.max(0, messages.length - PAGE_SIZE) : index
    function reveal(messageId?: string) {
        const target = messageId ? messages.findIndex((message) => message.id === messageId) : Math.max(0, startIndex - PAGE_SIZE)
        if (target >= 0 && target < startIndex) {
            setWindow({ conversationId, first: key(messages[target]) })
            return true
        }
        return false
    }
    return { startIndex, reveal }
}
